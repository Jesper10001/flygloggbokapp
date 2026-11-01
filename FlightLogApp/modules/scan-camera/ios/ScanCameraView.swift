import ExpoModulesCore
import AVFoundation
import CoreMotion
import UIKit

// Kameravyn: sökare + liggande ram + bokens kontur i realtid. Avgör när uppslaget ligger rätt, är skarpt
// och stilla och tar då bilden själv. Tillståndet skickas till JS (onStatus) som visar texten och knapparna.
//
// Tillstånd (state): starting, searching, fitInFrame, moveCloser, center, tilt, dark, holdStill, focus,
// ready (progress 0→1 innan avtryckaren går), capturing, turnPage (väntar på att sidan vänds).
final class ScanCameraView: ExpoView {
  static let defaultSharpnessMin: Double = 25
  // Hur mycket bilden måste ändras (medelavvikelse 0–255) efter en tagning innan nästa uppslag tas.
  static let pageTurnDiff: Double = 12

  let onStatus = EventDispatcher()
  let onCapture = EventDispatcher()
  let onCameraError = EventDispatcher()

  var autoCapture = true
  var sharpnessMin: Double = ScanCameraView.defaultSharpnessMin

  private let engine = ScanCameraEngine()
  private let previewLayer = AVCaptureVideoPreviewLayer()
  private let dimLayer = CAShapeLayer()
  private let guideLayer = CAShapeLayer()
  private let quadLayer = CAShapeLayer()
  private let flashLayer = CALayer()
  private let motion = CMMotionManager()

  private var wantsActive = false
  private var running = false
  private var observingOrientation = false
  private var guideAspect: CGFloat = 1.5
  private var guideInsets = UIEdgeInsets.zero
  private var guideRect = CGRect.zero

  private var smoothed: [CGPoint]?
  private var lastQuadNorm: [CGPoint]?
  private var cornerHistory: [[CGPoint]] = []
  private var lostCount = 0
  private var holdProgress: Double = 0
  private var lastResultAt: CFTimeInterval = 0
  private var peakSharpness: Double = 0
  private var aspectMismatchSince: CFTimeInterval = 0
  private var capturing = false
  private var cooldown = false
  private var lastCaptureAt: CFTimeInterval = 0
  private var capturedSignature: [UInt8] = []
  private var lastSignature: [UInt8] = []
  private var lastState = ""
  private var lastEmitAt: CFTimeInterval = 0

  private static let cyan = UIColor(red: 0, green: 200 / 255, blue: 232 / 255, alpha: 1)
  private static let green = UIColor(red: 0, green: 232 / 255, blue: 160 / 255, alpha: 1)

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .black
    clipsToBounds = true

    previewLayer.session = engine.session
    previewLayer.videoGravity = .resizeAspectFill
    layer.addSublayer(previewLayer)

    dimLayer.fillRule = .evenOdd
    dimLayer.fillColor = UIColor(white: 0, alpha: 0.38).cgColor
    layer.addSublayer(dimLayer)

    quadLayer.lineWidth = 2
    quadLayer.lineJoin = .round
    quadLayer.opacity = 0
    layer.addSublayer(quadLayer)

    guideLayer.fillColor = UIColor.clear.cgColor
    guideLayer.strokeColor = UIColor(white: 1, alpha: 0.92).cgColor
    guideLayer.lineWidth = 4
    guideLayer.lineCap = .round
    guideLayer.lineJoin = .round
    layer.addSublayer(guideLayer)

    flashLayer.backgroundColor = UIColor.white.cgColor
    flashLayer.opacity = 0
    layer.addSublayer(flashLayer)

    engine.onAnalysis = { [weak self] analysis in self?.handle(analysis) }
    engine.onCaptured = { [weak self] result, request in self?.finishCapture(result, request) }
    // Förhandsvisningens anslutning finns först när sessionen är igång → sätt orienteringen då.
    engine.onStarted = { [weak self] in
      self?.updatePreviewOrientation()
      self?.updateGuide(animated: false)
    }
    engine.onSetupError = { [weak self] message in
      self?.onCameraError(["code": "setup", "message": message])
    }
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  deinit {
    engine.stop()
    motion.stopGyroUpdates()
    NotificationCenter.default.removeObserver(self)
  }

  // MARK: Props

  func setActive(_ value: Bool) {
    wantsActive = value
    updateRunning()
  }

  func setTorch(_ on: Bool) {
    engine.setTorch(on)
  }

  func setGuideAspect(_ value: Double) {
    let aspect = CGFloat(min(max(value, 0.9), 3.4))
    guard abs(aspect - guideAspect) > 0.001 else { return }
    guideAspect = aspect
    updateGuide(animated: bounds.width > 0)
  }

  func setGuideInsets(_ value: [Double]) {
    guard value.count == 4 else { return }
    guideInsets = UIEdgeInsets(top: value[0], left: value[3], bottom: value[2], right: value[1])
    updateGuide(animated: false)
  }

  // MARK: Livscykel

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil, !observingOrientation {
      observingOrientation = true
      UIDevice.current.beginGeneratingDeviceOrientationNotifications()
      NotificationCenter.default.addObserver(
        self, selector: #selector(orientationChanged),
        name: UIDevice.orientationDidChangeNotification, object: nil)
    } else if window == nil, observingOrientation {
      observingOrientation = false
      UIDevice.current.endGeneratingDeviceOrientationNotifications()
      NotificationCenter.default.removeObserver(self, name: UIDevice.orientationDidChangeNotification, object: nil)
    }
    updateRunning()
  }

  private func updateRunning() {
    let shouldRun = wantsActive && window != nil
    guard shouldRun != running else { return }
    running = shouldRun
    if shouldRun {
      guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
        running = false
        onCameraError(["code": "permission", "message": "Camera access is turned off for Blades."])
        return
      }
      engine.start()
      if motion.isGyroAvailable {
        motion.gyroUpdateInterval = 0.1
        motion.startGyroUpdates()
      }
      emitStatus("starting", nil, force: true)
    } else {
      engine.stop()
      motion.stopGyroUpdates()
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    for l in [previewLayer, dimLayer, guideLayer, quadLayer, flashLayer] as [CALayer] { l.frame = bounds }
    CATransaction.commit()
    updatePreviewOrientation()
    updateGuide(animated: false)
  }

  @objc private func orientationChanged() {
    // Gränssnittet hinner vrida sig först (180° mellan de två liggande lägena).
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
      self?.updatePreviewOrientation()
      self?.resetTracking()
    }
  }

  private var interfaceOrientation: UIInterfaceOrientation {
    window?.windowScene?.interfaceOrientation ?? .landscapeRight
  }

  private func updatePreviewOrientation() {
    guard let connection = previewLayer.connection else { return }
    let o = interfaceOrientation
    if #available(iOS 17.0, *) {
      let angle: CGFloat
      switch o {
      case .portrait: angle = 90
      case .portraitUpsideDown: angle = 270
      case .landscapeLeft: angle = 180
      default: angle = 0
      }
      if connection.isVideoRotationAngleSupported(angle) { connection.videoRotationAngle = angle }
    } else if connection.isVideoOrientationSupported {
      switch o {
      case .portrait: connection.videoOrientation = .portrait
      case .portraitUpsideDown: connection.videoOrientation = .portraitUpsideDown
      case .landscapeLeft: connection.videoOrientation = .landscapeLeft
      default: connection.videoOrientation = .landscapeRight
      }
    }
  }

  // MARK: Ramen

  private func computeGuideRect(aspect: CGFloat) -> CGRect {
    let usable = bounds.inset(by: guideInsets)
    guard usable.width > 20, usable.height > 20 else { return .zero }
    var w = usable.width
    var h = w / aspect
    if h > usable.height { h = usable.height; w = h * aspect }
    w *= 0.96
    h *= 0.96
    return CGRect(x: usable.midX - w / 2, y: usable.midY - h / 2, width: w, height: h)
  }

  private func updateGuide(animated: Bool) {
    guideRect = computeGuideRect(aspect: guideAspect)
    guard guideRect.width > 0 else { return }
    let brackets = ScanCameraView.bracketsPath(guideRect).cgPath
    let dimPath = UIBezierPath(rect: bounds)
    dimPath.append(UIBezierPath(roundedRect: guideRect, cornerRadius: 12))
    if animated {
      for (shape, path) in [(guideLayer, brackets), (dimLayer, dimPath.cgPath)] {
        let anim = CABasicAnimation(keyPath: "path")
        anim.fromValue = shape.presentation()?.path ?? shape.path
        anim.toValue = path
        anim.duration = 0.28
        anim.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        shape.add(anim, forKey: "path")
      }
    }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    guideLayer.path = brackets
    dimLayer.path = dimPath.cgPath
    CATransaction.commit()
  }

  // Hörnmarkeringar i stället för en hel ram — som en sökare.
  private static func bracketsPath(_ r: CGRect) -> UIBezierPath {
    let p = UIBezierPath()
    let len = min(r.width, r.height) * 0.16
    let rad: CGFloat = 12
    p.move(to: CGPoint(x: r.minX, y: r.minY + len))
    p.addLine(to: CGPoint(x: r.minX, y: r.minY + rad))
    p.addQuadCurve(to: CGPoint(x: r.minX + rad, y: r.minY), controlPoint: CGPoint(x: r.minX, y: r.minY))
    p.addLine(to: CGPoint(x: r.minX + len, y: r.minY))

    p.move(to: CGPoint(x: r.maxX - len, y: r.minY))
    p.addLine(to: CGPoint(x: r.maxX - rad, y: r.minY))
    p.addQuadCurve(to: CGPoint(x: r.maxX, y: r.minY + rad), controlPoint: CGPoint(x: r.maxX, y: r.minY))
    p.addLine(to: CGPoint(x: r.maxX, y: r.minY + len))

    p.move(to: CGPoint(x: r.maxX, y: r.maxY - len))
    p.addLine(to: CGPoint(x: r.maxX, y: r.maxY - rad))
    p.addQuadCurve(to: CGPoint(x: r.maxX - rad, y: r.maxY), controlPoint: CGPoint(x: r.maxX, y: r.maxY))
    p.addLine(to: CGPoint(x: r.maxX - len, y: r.maxY))

    p.move(to: CGPoint(x: r.minX + len, y: r.maxY))
    p.addLine(to: CGPoint(x: r.minX + rad, y: r.maxY))
    p.addQuadCurve(to: CGPoint(x: r.minX, y: r.maxY - rad), controlPoint: CGPoint(x: r.minX, y: r.maxY))
    p.addLine(to: CGPoint(x: r.minX, y: r.maxY - len))
    return p
  }

  // MARK: Analys → tillstånd

  private func resetTracking() {
    smoothed = nil
    lastQuadNorm = nil
    cornerHistory.removeAll()
    holdProgress = 0
    peakSharpness = 0
    aspectMismatchSince = 0
    hideQuad()
  }

  private func handle(_ a: FrameAnalysis) {
    guard running, !capturing, guideRect.width > 0 else { return }
    let now = CACurrentMediaTime()
    let dt = lastResultAt > 0 ? min(0.25, now - lastResultAt) : 0.1
    lastResultAt = now
    lastSignature = a.signature

    guard let qn = a.quad else {
      lostCount += 1
      if lostCount >= 3 { resetTracking() }
      // Under sidvändningen skymmer handen boken → då är det ett nytt uppslag nästa gång.
      if cooldown && lostCount >= 4 && now - lastCaptureAt > 0.6 { cooldown = false }
      let state = cooldown ? "turnPage" : (a.brightness > 0 && a.brightness < 45 ? "dark" : "searching")
      emitStatus(state, a)
      return
    }
    lostCount = 0
    lastQuadNorm = qn

    let pts = qn.map { previewLayer.layerPointConverted(fromCaptureDevicePoint: CGPoint(x: $0.x, y: 1 - $0.y)) }
    let sm: [CGPoint]
    if let prev = smoothed, prev.count == 4 {
      sm = zip(prev, pts).map { CGPoint(x: $0.x * 0.45 + $1.x * 0.55, y: $0.y * 0.45 + $1.y * 0.55) }
    } else {
      sm = pts
    }
    smoothed = sm
    cornerHistory.append(pts)
    if cornerHistory.count > 6 { cornerHistory.removeFirst() }

    if cooldown {
      let diff = ScanCameraView.signatureDiff(a.signature, capturedSignature)
      if now - lastCaptureAt > 1.2 && diff > ScanCameraView.pageTurnDiff {
        cooldown = false
      } else {
        drawQuad(sm, ready: false, faded: true)
        emitStatus("turnPage", a, extra: ["sceneDiff": diff])
        return
      }
    }

    let bb = ScanCameraView.boundingBox(sm)
    let guideArea = guideRect.width * guideRect.height
    let coverage = guideArea > 0 ? Double(polygonArea(sm) / guideArea) : 0
    let inside = sm.allSatisfy { bounds.insetBy(dx: 4, dy: 4).contains($0) }
    let top = ScanCameraView.dist(sm[0], sm[1]), bottom = ScanCameraView.dist(sm[3], sm[2])
    let left = ScanCameraView.dist(sm[0], sm[3]), right = ScanCameraView.dist(sm[1], sm[2])
    let skew = Double(min(min(top, bottom) / max(top, bottom, 1), min(left, right) / max(left, right, 1)))
    let centerOffset = Double(hypot(bb.midX - guideRect.midX, bb.midY - guideRect.midY) / max(guideRect.width, 1))
    let jitter = Double(cornerJitter() / max(guideRect.width, 1))
    var gyro = 0.0
    if let r = motion.gyroData?.rotationRate { gyro = sqrt(r.x * r.x + r.y * r.y + r.z * r.z) }
    peakSharpness = max(peakSharpness * 0.995, a.sharpness)
    let sharpOk = !engine.isAdjustingFocus && a.sharpness >= sharpnessMin && a.sharpness >= peakSharpness * 0.7

    // Ramen anpassar sig efter bokens proportioner (loggböcker skiljer sig mycket åt).
    let quadAspect = bb.width / max(bb.height, 1)
    if inside && skew > 0.8 && jitter < 0.03 && abs(quadAspect - guideAspect) / guideAspect > 0.12 {
      if aspectMismatchSince == 0 {
        aspectMismatchSince = now
      } else if now - aspectMismatchSince > 0.7 {
        guideAspect = min(max(quadAspect, 0.9), 3.4)
        updateGuide(animated: true)
        aspectMismatchSince = 0
      }
    } else {
      aspectMismatchSince = 0
    }

    let state: String
    if !inside { state = "fitInFrame" }
    else if coverage < 0.6 { state = "moveCloser" }
    else if centerOffset > 0.12 { state = "center" }
    else if skew < 0.82 { state = "tilt" }
    else if a.brightness < 45 { state = "dark" }
    else if jitter > 0.02 || gyro > 0.35 { state = "holdStill" }
    else if !sharpOk { state = "focus" }
    else { state = "ready" }

    if state == "ready" {
      holdProgress = min(1, holdProgress + dt / 0.6)
    } else {
      holdProgress = max(0, holdProgress - dt / 0.3)
    }
    drawQuad(sm, ready: state == "ready", faded: false)
    emitStatus(state, a, extra: ["coverage": coverage, "skew": skew, "jitter": jitter])

    if state == "ready" && holdProgress >= 1 && autoCapture {
      capture(auto: true)
    }
  }

  private func cornerJitter() -> CGFloat {
    guard cornerHistory.count >= 3, let last = cornerHistory.last else { return 1 }
    var maxD: CGFloat = 0
    for frame in cornerHistory.dropLast() {
      for (a, b) in zip(frame, last) { maxD = max(maxD, ScanCameraView.dist(a, b)) }
    }
    return maxD
  }

  private func drawQuad(_ pts: [CGPoint], ready: Bool, faded: Bool) {
    let path = UIBezierPath()
    path.move(to: pts[0])
    for p in pts.dropFirst() { path.addLine(to: p) }
    path.close()
    let color = ready ? ScanCameraView.green : ScanCameraView.cyan
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    quadLayer.path = path.cgPath
    quadLayer.strokeColor = color.cgColor
    quadLayer.fillColor = color.withAlphaComponent(faded ? 0.05 : 0.14).cgColor
    quadLayer.opacity = faded ? 0.45 : 1
    guideLayer.strokeColor = (ready ? ScanCameraView.green : UIColor(white: 1, alpha: 0.92)).cgColor
    CATransaction.commit()
  }

  private func hideQuad() {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    quadLayer.opacity = 0
    guideLayer.strokeColor = UIColor(white: 1, alpha: 0.92).cgColor
    CATransaction.commit()
  }

  private func emitStatus(_ state: String, _ a: FrameAnalysis?, extra: [String: Any] = [:], force: Bool = false) {
    let now = CACurrentMediaTime()
    let interval = state == "ready" ? 0.1 : 0.4
    guard force || state != lastState || now - lastEmitAt >= interval else { return }
    lastState = state
    lastEmitAt = now
    var payload: [String: Any] = ["state": state, "progress": holdProgress, "aspect": Double(guideAspect)]
    if let a {
      payload["sharpness"] = a.sharpness
      payload["brightness"] = a.brightness
      payload["detector"] = a.detector
    }
    for (k, v) in extra { payload[k] = v }
    onStatus(payload)
  }

  // MARK: Tagning

  func captureManually() {
    capture(auto: false)
  }

  // JS anropar detta när användaren vill ta om ett uppslag (vänta inte på sidvändning).
  func rearm() {
    cooldown = false
    holdProgress = 0
  }

  private func capture(auto: Bool) {
    guard running, !capturing else { return }
    capturing = true
    holdProgress = 0
    let orientation = interfaceOrientation
    let previewQuad = lastQuadNorm.map { ScanCameraEngine.screenOrdered($0, orientation) }
    var guideQuad: [CGPoint]?
    if guideRect.width > 0 {
      let g = guideRect
      let corners = [CGPoint(x: g.minX, y: g.minY), CGPoint(x: g.maxX, y: g.minY),
                     CGPoint(x: g.maxX, y: g.maxY), CGPoint(x: g.minX, y: g.maxY)]
      guideQuad = corners.map {
        let d = previewLayer.captureDevicePointConverted(fromLayerPoint: $0)
        return CGPoint(x: d.x, y: 1 - d.y)
      }
    }
    capturedSignature = lastSignature
    emitStatus("capturing", nil, force: true)
    flash()
    engine.capture(PendingCapture(auto: auto, previewQuad: previewQuad, guideQuad: guideQuad, orientation: orientation))
  }

  private func finishCapture(_ result: Result<CaptureResult, Error>, _ request: PendingCapture) {
    capturing = false
    switch result {
    case .success(let r):
      cooldown = true
      lastCaptureAt = CACurrentMediaTime()
      peakSharpness = 0
      holdProgress = 0
      onCapture(["uri": r.uri, "width": r.width, "height": r.height, "detected": r.detected, "auto": request.auto])
      emitStatus("turnPage", nil, force: true)
    case .failure(let error):
      onCameraError(["code": "capture", "message": error.localizedDescription])
      emitStatus("searching", nil, force: true)
    }
  }

  private func flash() {
    let anim = CABasicAnimation(keyPath: "opacity")
    anim.fromValue = 0.75
    anim.toValue = 0
    anim.duration = 0.3
    anim.timingFunction = CAMediaTimingFunction(name: .easeOut)
    flashLayer.add(anim, forKey: "flash")
  }

  // MARK: Hjälpare

  private static func dist(_ a: CGPoint, _ b: CGPoint) -> CGFloat { hypot(a.x - b.x, a.y - b.y) }

  private static func boundingBox(_ p: [CGPoint]) -> CGRect {
    let xs = p.map { $0.x }, ys = p.map { $0.y }
    let minX = xs.min() ?? 0, maxX = xs.max() ?? 0, minY = ys.min() ?? 0, maxY = ys.max() ?? 0
    return CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
  }

  private static func signatureDiff(_ a: [UInt8], _ b: [UInt8]) -> Double {
    guard !a.isEmpty, a.count == b.count else { return 255 }
    var total = 0
    for i in 0..<a.count { total += abs(Int(a[i]) - Int(b[i])) }
    return Double(total) / Double(a.count)
  }
}
