Pod::Spec.new do |s|
  s.name           = 'AppleSubjectLift'
  s.version        = '1.0.0'
  s.summary        = 'On-device subject lifting via VisionKit (foreground instance mask).'
  s.description    = 'Local Expo module wrapping VNGenerateForegroundInstanceMaskRequest to cut an aircraft out of its background to a transparent PNG (iOS 17+). Graceful no-op below iOS 17.'
  s.author         = ''
  s.homepage       = 'https://github.com/blades/apple-subject-lift'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
