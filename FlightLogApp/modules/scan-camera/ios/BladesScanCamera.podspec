Pod::Spec.new do |s|
  s.name           = 'BladesScanCamera'
  s.version        = '1.0.0'
  s.summary        = 'Logbook scan camera with edge detection and auto capture.'
  s.description    = 'Local Expo module: camera view that finds an open logbook spread (Apple Vision), checks framing, sharpness and light, and captures a perspective-corrected photo automatically.'
  s.author         = ''
  s.homepage       = 'https://github.com/blades/scan-camera'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
