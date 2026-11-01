import AVFoundation
import Vision
import CoreImage
import UIKit

// Resultatet av en analyserad videobild. Koordinater i Visions normaliserade system för den oroterade
// sensorbilden (origo nere till vänster), hörnen i Visions ordning TL, TR, BR, BL.
struct FrameAnalysis {
  let quad: [CGPoint]?
  let detector: String      // "doc" (dokumentsegmentering), "rect" (rektangel) eller "none"
  let sharpness: Double     // Laplace-varians inom boken — högre = skarpare
  let brightness: Double    // medelluminans 0–255
  let signature: [UInt8]    // 16×12 medelvärden — för att se om sidan har vänts efter en tagning
}

// Det som behövs för att färdigställa en tagning. Hörnen är i skärmordning (TL, TR, BR, BL som användaren
// ser dem) så att den uppräta bilden blir rätt vänd utan extra rotation.
struct PendingCapture {
  let auto: Bool
  let previewQuad: [CGPoint]?
  let guideQuad: [CGPoint]?
  let orientation: UIInterfaceOrientation
}

struct CaptureResult {
  let uri: String
  let width: Int
  let height: Int
  let detected: Bool
}

// Kamerasessionen, bildanalysen och tagningen. Ingen UI här; ScanCameraView får resultaten på huvudtråden.
final class ScanCameraEngine: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate, AVCapturePhotoCaptureDelegate {
  let session = AVCaptureSession()
  private let sessionQueue = DispatchQueue(label: "blades.scan.session")
  private let analysisQueue = DispatchQueue(label: "blades.scan.analysis", qos: .userInitiated)
  private let processingQueue = DispatchQueue(label: "blades.scan.processing", qos: .userInitiated)
  private let videoOutput = AVCaptureVideoDataOutput()
  private let photoOutput = AVCapturePhotoOutput()
  private(set) var device: AVCaptureDevice?
  private var configured = false
  private var torchOn = false
  private var lastAnalysisAt: CFTimeInterval = 0
  private var pending: PendingCapture?
  private lazy var ciContext = CIContext()

  var onAnalysis: ((FrameAnalysis) -> Void)?
  var onCaptured: ((Result<CaptureResult, Error>, PendingCapture) -> Void)?
  var onSetupError: ((String) -> Void)?
  var onStarted: (() -> Void)?

  var isAdjustingFocus: Bool { device?.isAdjustingFocus ?? false }

  // MARK: Session

  func start() {
    sessionQueue.async { [weak self] in
      guard let self else { return }
      if !self.configured {
        if let message = self.configure() {
          DispatchQueue.main.async { self.onSetupError?(message) }
          return
        }
        self.configured = true
      }
      if !self.session.isRunning { self.session.startRunning() }
      self.applyTorch()
      DispatchQueue.main.async { self.onStarted?() }
    }
  }

  func stop() {
    let session = self.session
    sessionQueue.async {
      if session.isRunning { session.stopRunning() }
    }
  }

  private func configure() -> String? {
    guard let dev = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else {
      return "No camera found on this device."
    }
    session.beginConfiguration()
    session.sessionPreset = .photo   // 4:3 — samma bildfält i videon och i fotot
    guard let input = try? AVCaptureDeviceInput(device: dev), session.canAddInput(input) else {
      session.commitConfiguration()
      return "Could not open the camera."
    }
    session.addInput(input)
    videoOutput.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange]
    videoOutput.alwaysDiscardsLateVideoFrames = true
    videoOutput.setSampleBufferDelegate(self, queue: analysisQueue)
    guard session.canAddOutput(videoOutput), session.canAddOutput(photoOutput) else {
      session.commitConfiguration()
      return "Could not start the camera."
    }
    session.addOutput(videoOutput)
    session.addOutput(photoOutput)
    session.commitConfiguration()

    if #available(iOS 16.0, *) {
      // Högst ~12 MP: mer gör inte handstilen läsbarare men gör bilden tung att räta upp.
      let dims = dev.activeFormat.supportedMaxPhotoDimensions
      let capped = dims.filter { $0.width <= 4100 }
      if let best = (capped.isEmpty ? dims : capped).max(by: { Int($0.width) * Int($0.height) < Int($1.width) * Int($1.height) }) {
        photoOutput.maxPhotoDimensions = best
      }
    } else {
      photoOutput.isHighResolutionCaptureEnabled = true
    }
    photoOutput.maxPhotoQualityPrioritization = .quality

    do {
      try dev.lockForConfiguration()
      if dev.isFocusModeSupported(.continuousAutoFocus) { dev.focusMode = .continuousAutoFocus }
      // Boken ligger 25–60 cm bort: begränsa autofokus till närområdet så den inte jagar bakgrunden.
      if dev.isAutoFocusRangeRestrictionSupported { dev.autoFocusRangeRestriction = .near }
      if dev.isSmoothAutoFocusSupported { dev.isSmoothAutoFocusEnabled = false }
      if dev.isExposureModeSupported(.continuousAutoExposure) { dev.exposureMode = .continuousAutoExposure }
      dev.unlockForConfiguration()
    } catch {
      // Standardinställningarna fungerar också.
    }
    device = dev
    return nil
  }

  func setTorch(_ on: Bool) {
    sessionQueue.async { [weak self] in
      self?.torchOn = on
      self?.applyTorch()
    }
  }

  private func applyTorch() {
    guard configured, let dev = device, dev.hasTorch, session.isRunning else { return }
    do {
      try dev.lockForConfiguration()
      dev.torchMode = torchOn ? .on : .off
      dev.unlockForConfiguration()
    } catch {
      // Lampan är inte kritisk.
    }
  }

  // MARK: Analys av videobilder

  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    let now = CACurrentMediaTime()
    if now - lastAnalysisAt < 0.08 { return }   // ~12 analyser/s räcker och sparar batteri
    lastAnalysisAt = now
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .up, options: [:])
    let (quad, detector) = ScanCameraEngine.detect(handler: handler)
    let metrics = ScanCameraEngine.measure(pixelBuffer: pixelBuffer, quad: quad)
    let analysis = FrameAnalysis(quad: quad, detector: detector, sharpness: metrics.sharpness,
                                 brightness: metrics.brightness, signature: metrics.signature)
    DispatchQueue.main.async { [weak self] in self?.onAnalysis?(analysis) }
  }

  // Dokumentsegmenteringen (iOS 15+) hittar oftast hela uppslaget; rektangeldetektorn tar över när den
  // inte gör det (t.ex. mörk bordsskiva runt en ljus bok).
  static func detect(handler: VNImageRequestHandler) -> ([CGPoint]?, String) {
    let doc = VNDetectDocumentSegmentationRequest()
    if (try? handler.perform([doc])) != nil, let obs = doc.results?.first, obs.confidence >= 0.6 {
      let q = [obs.topLeft, obs.topRight, obs.bottomRight, obs.bottomLeft]
      if polygonArea(q) >= 0.08 { return (q, "doc") }
    }
    let rect = VNDetectRectanglesRequest()
    rect.minimumAspectRatio = 0.2
    rect.maximumAspectRatio = 1.0
    rect.minimumSize = 0.3
    rect.quadratureTolerance = 25
    rect.minimumConfidence = 0.6
    rect.maximumObservations = 1
    if (try? handler.perform([rect])) != nil, let obs = rect.results?.first {
      return ([obs.topLeft, obs.topRight, obs.bottomRight, obs.bottomLeft], "rect")
    }
    return (nil, "none")
  }

  // Skärpa (Laplace-varians), ljus och en grov signatur inom bokens omslutande rektangel, från luma-planet.
  static func measure(pixelBuffer pb: CVPixelBuffer, quad: [CGPoint]?) -> (sharpness: Double, brightness: Double, signature: [UInt8]) {
    CVPixelBufferLockBaseAddress(pb, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
    guard CVPixelBufferGetPlaneCount(pb) >= 1, let base = CVPixelBufferGetBaseAddressOfPlane(pb, 0) else {
      return (0, 0, [])
    }
    let w = CVPixelBufferGetWidthOfPlane(pb, 0)
    let h = CVPixelBufferGetHeightOfPlane(pb, 0)
    let stride = CVPixelBufferGetBytesPerRowOfPlane(pb, 0)
    let luma = base.assumingMemoryBound(to: UInt8.self)

    var x0 = Int(Double(w) * 0.2), x1 = Int(Double(w) * 0.8)
    var y0 = Int(Double(h) * 0.2), y1 = Int(Double(h) * 0.8)
    if let q = quad {
      let xs = q.map { $0.x }, ys = q.map { 1 - $0.y }   // → origo uppe till vänster
      x0 = Int((xs.min() ?? 0) * CGFloat(w)); x1 = Int((xs.max() ?? 1) * CGFloat(w))
      y0 = Int((ys.min() ?? 0) * CGFloat(h)); y1 = Int((ys.max() ?? 1) * CGFloat(h))
    }
    x0 = max(2, x0); y0 = max(2, y0); x1 = min(w - 3, x1); y1 = min(h - 3, y1)
    guard x1 - x0 > 40, y1 - y0 > 40 else { return (0, 0, []) }

    // Glest rutnät (~220×150 punkter). Grannarna ligger 1 px bort, så måttet fångar fin skärpa (handstil).
    let stepX = max(1, (x1 - x0) / 220), stepY = max(1, (y1 - y0) / 150)
    var sum = 0.0, sumSq = 0.0, lum = 0.0, n = 0.0
    var yy = y0
    while yy < y1 {
      let row = luma + yy * stride
      let up = row - stride, down = row + stride
      var xx = x0
      while xx < x1 {
        let c = Double(row[xx])
        let lap = 4 * c - Double(row[xx - 1]) - Double(row[xx + 1]) - Double(up[xx]) - Double(down[xx])
        sum += lap; sumSq += lap * lap; lum += c; n += 1
        xx += stepX
      }
      yy += stepY
    }
    guard n > 0 else { return (0, 0, []) }
    let mean = sum / n
    let variance = max(0, sumSq / n - mean * mean)

    var signature = [UInt8](repeating: 0, count: 16 * 12)
    let cw = max(1, (x1 - x0) / 16), ch = max(1, (y1 - y0) / 12)
    for gy in 0..<12 {
      for gx in 0..<16 {
        var s = 0, count = 0
        var py = y0 + gy * ch
        let pyEnd = min(y1, py + ch)
        while py < pyEnd {
          let row = luma + py * stride
          var px = x0 + gx * cw
          let pxEnd = min(x1, px + cw)
          while px < pxEnd { s += Int(row[px]); count += 1; px += 3 }
          py += 3
        }
        signature[gy * 16 + gx] = UInt8(count > 0 ? s / count : 0)
      }
    }
    return (variance, lum / n, signature)
  }

  // MARK: Tagning

  func capture(_ request: PendingCapture) {
    sessionQueue.async { [weak self] in
      guard let self, self.configured, self.session.isRunning else { return }
      self.pending = request
      let settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
      if #available(iOS 16.0, *) {
        settings.maxPhotoDimensions = self.photoOutput.maxPhotoDimensions
      } else {
        settings.isHighResolutionPhotoEnabled = true
      }
      settings.photoQualityPrioritization = .balanced
      settings.flashMode = .off
      self.photoOutput.capturePhoto(with: settings, delegate: self)
    }
  }

  func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
    guard let request = pending else { return }
    pending = nil
    if let error {
      DispatchQueue.main.async { [weak self] in self?.onCaptured?(.failure(error), request) }
      return
    }
    processingQueue.async { [weak self] in
      guard let self else { return }
      let result = self.process(photo: photo, request: request)
      DispatchQueue.main.async { self.onCaptured?(result, request) }
    }
  }

  // Letar upp boken på nytt i det skarpa fotot, rätar upp perspektivet och sparar en JPEG i cachen.
  private func process(photo: AVCapturePhoto, request: PendingCapture) -> Result<CaptureResult, Error> {
    guard let cg = photo.cgImageRepresentation() else {
      return .failure(ScanCameraError("Could not read the photo."))
    }
    let width = CGFloat(cg.width), height = CGFloat(cg.height)

    var quad: [CGPoint]? = nil
    var detected = false
    let (found, _) = ScanCameraEngine.detect(handler: VNImageRequestHandler(cgImage: cg, orientation: .up, options: [:]))
    if let found {
      let ordered = ScanCameraEngine.screenOrdered(found, request.orientation)
      if let preview = request.previewQuad {
        // Samma bok som i sökaren? Annars är förhandsvisningens hörn säkrare.
        if ScanCameraEngine.maxCornerDistance(ordered, preview) < 0.08 { quad = ordered; detected = true }
      } else if polygonArea(ordered) > 0.15 {
        quad = ordered; detected = true
      }
    }
    if quad == nil, let preview = request.previewQuad { quad = preview; detected = true }
    if quad == nil { quad = request.guideQuad }

    var image = CIImage(cgImage: cg)
    if let q = quad, q.count == 4, let filter = CIFilter(name: "CIPerspectiveCorrection") {
      filter.setValue(image, forKey: kCIInputImageKey)
      filter.setValue(CIVector(x: q[0].x * width, y: q[0].y * height), forKey: "inputTopLeft")
      filter.setValue(CIVector(x: q[1].x * width, y: q[1].y * height), forKey: "inputTopRight")
      filter.setValue(CIVector(x: q[2].x * width, y: q[2].y * height), forKey: "inputBottomRight")
      filter.setValue(CIVector(x: q[3].x * width, y: q[3].y * height), forKey: "inputBottomLeft")
      if let out = filter.outputImage { image = out }
    } else {
      image = image.oriented(ScanCameraEngine.cgOrientation(request.orientation))
    }
    image = image.transformed(by: CGAffineTransform(translationX: -image.extent.origin.x, y: -image.extent.origin.y))

    guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
          let data = ciContext.jpegRepresentation(
            of: image, colorSpace: colorSpace,
            options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.9]) else {
      return .failure(ScanCameraError("Could not save the photo."))
    }
    do {
      let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("blades-scan", isDirectory: true)
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      let file = dir.appendingPathComponent("\(UUID().uuidString).jpg")
      try data.write(to: file)
      return .success(CaptureResult(uri: file.absoluteString, width: Int(image.extent.width),
                                    height: Int(image.extent.height), detected: detected))
    } catch {
      return .failure(error)
    }
  }

  // MARK: Geometri

  // Sorterar Visions hörn till skärmordning (TL, TR, BR, BL som användaren ser dem) för given orientering.
  static func screenOrdered(_ q: [CGPoint], _ orientation: UIInterfaceOrientation) -> [CGPoint] {
    guard q.count == 4 else { return q }
    func screen(_ p: CGPoint) -> CGPoint {
      let d = CGPoint(x: p.x, y: 1 - p.y)   // sensorns "device point" (origo uppe till vänster)
      switch orientation {
      case .landscapeLeft: return CGPoint(x: 1 - d.x, y: 1 - d.y)
      case .portrait: return CGPoint(x: 1 - d.y, y: d.x)
      case .portraitUpsideDown: return CGPoint(x: d.y, y: 1 - d.x)
      default: return d
      }
    }
    let s = q.map(screen)
    let idx = Array(0..<4)
    guard let tl = idx.min(by: { s[$0].x + s[$0].y < s[$1].x + s[$1].y }),
          let br = idx.max(by: { s[$0].x + s[$0].y < s[$1].x + s[$1].y }),
          let tr = idx.max(by: { s[$0].x - s[$0].y < s[$1].x - s[$1].y }),
          let bl = idx.min(by: { s[$0].x - s[$0].y < s[$1].x - s[$1].y }),
          Set([tl, tr, br, bl]).count == 4 else { return q }
    return [q[tl], q[tr], q[br], q[bl]]
  }

  static func cgOrientation(_ orientation: UIInterfaceOrientation) -> CGImagePropertyOrientation {
    switch orientation {
    case .landscapeLeft: return .down
    case .portrait: return .right
    case .portraitUpsideDown: return .left
    default: return .up
    }
  }

  static func maxCornerDistance(_ a: [CGPoint], _ b: [CGPoint]) -> CGFloat {
    guard a.count == 4, b.count == 4 else { return .greatestFiniteMagnitude }
    return zip(a, b).map { hypot($0.x - $1.x, $0.y - $1.y) }.max() ?? .greatestFiniteMagnitude
  }
}

struct ScanCameraError: LocalizedError {
  let message: String
  init(_ message: String) { self.message = message }
  var errorDescription: String? { message }
}

// Skosnöresformeln — fungerar i både normaliserade koordinater och punkter.
func polygonArea(_ p: [CGPoint]) -> CGFloat {
  guard p.count >= 3 else { return 0 }
  var a: CGFloat = 0
  for i in 0..<p.count {
    let j = (i + 1) % p.count
    a += p[i].x * p[j].y - p[j].x * p[i].y
  }
  return abs(a) / 2
}
