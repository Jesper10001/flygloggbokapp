Pod::Spec.new do |s|
  s.name           = 'AppleVisionOcr'
  s.version        = '1.0.0'
  s.summary        = 'On-device OCR via the Apple Vision framework (Live Text engine).'
  s.description    = 'Local Expo module wrapping VNRecognizeTextRequest for offline, private text recognition.'
  s.author         = ''
  s.homepage       = 'https://github.com/blades/apple-vision-ocr'
  s.platforms      = { :ios => '15.1', :tvos => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
