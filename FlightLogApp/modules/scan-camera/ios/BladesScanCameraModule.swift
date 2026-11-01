import ExpoModulesCore

// Skanningskameran för pappersloggboken. All logik ligger i ScanCameraView; modulen exponerar bara vyn,
// dess props och två funktioner (manuell avtryckare + "redo för nästa uppslag").
public class BladesScanCameraModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BladesScanCamera")

    View(ScanCameraView.self) {
      Events("onStatus", "onCapture", "onCameraError")

      Prop("active") { (view: ScanCameraView, value: Bool) in
        view.setActive(value)
      }
      Prop("autoCapture") { (view: ScanCameraView, value: Bool) in
        view.autoCapture = value
      }
      Prop("torch") { (view: ScanCameraView, value: Bool) in
        view.setTorch(value)
      }
      // Uppslagets proportion (bredd/höjd). Ramen startar här och anpassar sig efter boken kameran ser.
      Prop("guideAspect") { (view: ScanCameraView, value: Double) in
        view.setGuideAspect(value)
      }
      // [top, right, bottom, left] i punkter — plats för knapparna runt ramen.
      Prop("guideInsets") { (view: ScanCameraView, value: [Double]) in
        view.setGuideInsets(value)
      }
      // Lägsta skärpa (Laplace-varians) för att avtryckaren ska gå. 0 = standardvärdet.
      Prop("sharpnessMin") { (view: ScanCameraView, value: Double) in
        view.sharpnessMin = value > 0 ? value : ScanCameraView.defaultSharpnessMin
      }

      AsyncFunction("capture") { (view: ScanCameraView) in
        DispatchQueue.main.async { view.captureManually() }
      }
      AsyncFunction("rearm") { (view: ScanCameraView) in
        DispatchQueue.main.async { view.rearm() }
      }
    }
  }
}
