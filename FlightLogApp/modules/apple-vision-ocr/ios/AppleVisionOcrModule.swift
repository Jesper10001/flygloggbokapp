import ExpoModulesCore
import Vision
import UIKit

// On-device OCR via Apple Vision (VNRecognizeTextRequest) — samma motor som
// iOS "Live Text". Körs lokalt; inget lämnar enheten. Andra-läsare i OCR-ensemblen.
public class AppleVisionOcrModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AppleVisionOcr")

    // recognize(input, languages) → [{ text, confidence, x, y, w, h }]
    // input: file://-URI eller rå base64. Box är normaliserad med top-left origin.
    AsyncFunction("recognize") { (input: String, languages: [String], promise: Promise) in
      guard let cgImage = AppleVisionOcrModule.loadCGImage(input) else {
        promise.reject("E_IMAGE", "Kunde inte läsa bilden (file://-URI eller base64).")
        return
      }

      let request = VNRecognizeTextRequest { (req, err) in
        if let err = err {
          promise.reject("E_OCR", err.localizedDescription)
          return
        }
        let observations = (req.results as? [VNRecognizedTextObservation]) ?? []
        var out: [[String: Any]] = []
        out.reserveCapacity(observations.count)
        for obs in observations {
          guard let top = obs.topCandidates(1).first else { continue }
          let bb = obs.boundingBox // normaliserat, origin nedre-vänster
          out.append([
            "text": top.string,
            "confidence": Double(top.confidence),
            "x": Double(bb.origin.x),
            "y": Double(1.0 - bb.origin.y - bb.size.height), // → top-left origin
            "w": Double(bb.size.width),
            "h": Double(bb.size.height),
          ])
        }
        promise.resolve(out)
      }

      request.recognitionLevel = .accurate
      request.usesLanguageCorrection = true
      if !languages.isEmpty {
        // Osupporterade språk ignoreras tyst av Vision → säkert att sätta.
        request.recognitionLanguages = languages
      }

      let handler = VNImageRequestHandler(cgImage: cgImage, orientation: .up, options: [:])
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          try handler.perform([request])
        } catch {
          promise.reject("E_OCR", error.localizedDescription)
        }
      }
    }
  }

  // Laddar en CGImage från antingen en fil-URI/-sökväg eller en base64-sträng.
  private static func loadCGImage(_ input: String) -> CGImage? {
    if input.hasPrefix("file://") || input.hasPrefix("/") {
      let urlString = input.hasPrefix("file://") ? input : "file://" + input
      if let url = URL(string: urlString),
         let data = try? Data(contentsOf: url),
         let image = UIImage(data: data) {
        return image.cgImage
      }
    }
    let cleaned = input.replacingOccurrences(of: "\n", with: "").replacingOccurrences(of: "\r", with: "")
    if let data = Data(base64Encoded: cleaned, options: .ignoreUnknownCharacters),
       let image = UIImage(data: data) {
      return image.cgImage
    }
    return nil
  }
}
