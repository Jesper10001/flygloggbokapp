import ExpoModulesCore
import AVFoundation
import UIKit

// Bränner in en transparent overlay-PNG (route/stats/postcard, renderad i JS via ViewShot) ovanpå
// ett videospår och exporterar en ny MP4. Använder AVVideoCompositionCoreAnimationTool → inga
// tredjeparts-binärer, App Store-säkert, iOS-only. Kräver dev/EAS-build (ej Expo Go).
public class VideoOverlayModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VideoOverlay")

    // videoSize(videoUri) → { width, height } i VISAD (orienterad) pixelstorlek. JS renderar
    // overlayn i samma aspekt så den mappar 1:1 på videon.
    AsyncFunction("videoSize") { (videoUri: String, promise: Promise) in
      guard let url = VideoOverlayModule.fileURL(videoUri) else { promise.reject("E_INPUT", "Ogiltig video-URI"); return }
      let asset = AVURLAsset(url: url)
      guard let track = asset.tracks(withMediaType: .video).first else { promise.reject("E_TRACK", "Inget videospår"); return }
      let size = VideoOverlayModule.orientedSize(naturalSize: track.naturalSize, transform: track.preferredTransform)
      promise.resolve(["width": Double(size.width), "height": Double(size.height)])
    }

    // burnOverlay(videoUri, overlayUri, outputPath) → outputUri
    AsyncFunction("burnOverlay") { (videoUri: String, overlayUri: String, outputPath: String, promise: Promise) in
      VideoOverlayModule.run(videoUri: videoUri, overlayUri: overlayUri, outputPath: outputPath, promise: promise)
    }
  }

  // ── Hjälpare ────────────────────────────────────────────────────────────────
  private static func fileURL(_ s: String) -> URL? {
    if s.hasPrefix("file://") { return URL(string: s) }
    if s.hasPrefix("/") { return URL(fileURLWithPath: s) }
    return URL(string: s)
  }

  // Visad storlek (efter rotation) från naturalSize + preferredTransform.
  private static func orientedSize(naturalSize: CGSize, transform: CGAffineTransform) -> CGSize {
    let rect = CGRect(origin: .zero, size: naturalSize).applying(transform)
    return CGSize(width: abs(rect.width.rounded()), height: abs(rect.height.rounded()))
  }

  private static func run(videoUri: String, overlayUri: String, outputPath: String, promise: Promise) {
    guard let videoURL = fileURL(videoUri) else { promise.reject("E_INPUT", "Ogiltig video-URI"); return }
    let asset = AVURLAsset(url: videoURL)
    guard let track = asset.tracks(withMediaType: .video).first else { promise.reject("E_TRACK", "Inget videospår"); return }

    // Overlay-PNG (transparent, samma aspekt som videons visade storlek).
    guard let overlayURL = fileURL(overlayUri),
          let overlayData = try? Data(contentsOf: overlayURL),
          let overlayImage = UIImage(data: overlayData)?.cgImage else {
      promise.reject("E_OVERLAY", "Kunde inte läsa overlay-PNG"); return
    }

    let composition = AVMutableComposition()
    guard let compVideoTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
      promise.reject("E_COMP", "Kunde inte skapa videospår"); return
    }
    let timeRange = CMTimeRange(start: .zero, duration: asset.duration)
    do {
      try compVideoTrack.insertTimeRange(timeRange, of: track, at: .zero)
      if let audio = asset.tracks(withMediaType: .audio).first,
         let compAudio = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
        try? compAudio.insertTimeRange(timeRange, of: audio, at: .zero)
      }
    } catch {
      promise.reject("E_INSERT", error.localizedDescription); return
    }

    let transform = track.preferredTransform
    let renderSize = orientedSize(naturalSize: track.naturalSize, transform: transform)

    // Video-instruktion: rotera videospåret till visad orientering.
    let videoComposition = AVMutableVideoComposition()
    videoComposition.renderSize = renderSize
    videoComposition.frameDuration = CMTime(value: 1, timescale: 30)

    let instruction = AVMutableVideoCompositionInstruction()
    instruction.timeRange = timeRange
    let layerInstruction = AVMutableVideoCompositionLayerInstruction(assetTrack: compVideoTrack)
    layerInstruction.setTransform(transform, at: .zero)
    instruction.layerInstructions = [layerInstruction]
    videoComposition.instructions = [instruction]

    // Core Animation-lager: videoLayer i botten, overlayLayer ovanpå, i renderSize.
    let videoLayer = CALayer()
    videoLayer.frame = CGRect(origin: .zero, size: renderSize)
    let overlayLayer = CALayer()
    overlayLayer.frame = CGRect(origin: .zero, size: renderSize)
    overlayLayer.contents = overlayImage
    overlayLayer.contentsGravity = .resize // overlay renderas i exakt renderSize-aspekt → sträck 1:1
    overlayLayer.masksToBounds = true
    let parentLayer = CALayer()
    parentLayer.frame = CGRect(origin: .zero, size: renderSize)
    parentLayer.isGeometryFlipped = true // så overlayns top-left matchar videons (CA-origin är annars nedre-vänster)
    parentLayer.addSublayer(videoLayer)
    parentLayer.addSublayer(overlayLayer)
    videoComposition.animationTool = AVVideoCompositionCoreAnimationTool(postProcessingAsVideoLayer: videoLayer, in: parentLayer)

    let outURL = URL(fileURLWithPath: outputPath.replacingOccurrences(of: "file://", with: ""))
    try? FileManager.default.removeItem(at: outURL)
    guard let export = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else {
      promise.reject("E_EXPORT", "Kunde inte skapa export-session"); return
    }
    export.outputURL = outURL
    export.outputFileType = .mp4
    export.videoComposition = videoComposition
    export.shouldOptimizeForNetworkUse = true
    export.exportAsynchronously {
      DispatchQueue.main.async {
        switch export.status {
        case .completed: promise.resolve(outURL.absoluteString)
        case .failed:    promise.reject("E_EXPORT", export.error?.localizedDescription ?? "Export misslyckades")
        case .cancelled: promise.reject("E_CANCELLED", "Export avbröts")
        default:         promise.reject("E_EXPORT", "Oväntad export-status")
        }
      }
    }
  }
}
