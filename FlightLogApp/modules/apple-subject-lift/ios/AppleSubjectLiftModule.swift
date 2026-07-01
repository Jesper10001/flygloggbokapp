import ExpoModulesCore
import Vision
import UIKit
import CoreImage

// On-device subject lift via VisionKit (VNGenerateForegroundInstanceMaskRequest) —
// samma motor som Foton "Lyft motiv från bakgrund". Klipper ut luftfartyget ur
// bakgrunden till en transparent PNG. Körs lokalt; inget lämnar enheten. iOS 17+.
public class AppleSubjectLiftModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AppleSubjectLift")

    // liftSubject(inputUri, outputPath) → file://-URI till en transparent PNG.
    // inputUri: file://-URI/-sökväg eller rå base64. outputPath: dit PNG:en skrivs.
    AsyncFunction("liftSubject") { (inputUri: String, outputPath: String, promise: Promise) in
      guard #available(iOS 17.0, *) else {
        promise.reject("E_UNSUPPORTED", "Subject lifting requires iOS 17 or later.")
        return
      }
      guard let cgImage = AppleSubjectLiftModule.loadCGImage(inputUri) else {
        promise.reject("E_IMAGE", "Could not read the input image (file:// URI or base64).")
        return
      }

      DispatchQueue.global(qos: .userInitiated).async {
        let request = VNGenerateForegroundInstanceMaskRequest()
        let handler = VNImageRequestHandler(cgImage: cgImage, orientation: .up, options: [:])
        do {
          try handler.perform([request])
          guard let result = request.results?.first, !result.allInstances.isEmpty else {
            promise.reject("E_NOSUBJECT", "No foreground subject found in the image.")
            return
          }
          // croppedToInstancesExtent: false → samma dimensioner som originalet,
          // motivet på sin ursprungsplats + transparent bakgrund. Krävs för att
          // banner-lagret och urklippslagret ska ligga i exakt samma skala/position.
          let pixelBuffer = try result.generateMaskedImage(
            ofInstances: result.allInstances,
            from: handler,
            croppedToInstancesExtent: false
          )
          let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
          let ciContext = CIContext()
          guard let outCg = ciContext.createCGImage(ciImage, from: ciImage.extent) else {
            promise.reject("E_RENDER", "Could not render the masked image.")
            return
          }
          guard let png = UIImage(cgImage: outCg).pngData() else {
            promise.reject("E_PNG", "Could not encode the cut-out as PNG.")
            return
          }
          let path = outputPath.hasPrefix("file://") ? String(outputPath.dropFirst(7)) : outputPath
          try png.write(to: URL(fileURLWithPath: path))
          promise.resolve("file://" + path)
        } catch {
          promise.reject("E_LIFT", error.localizedDescription)
        }
      }
    }
  }

  // Laddar en CGImage från en fil-URI/-sökväg eller en base64-sträng.
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
