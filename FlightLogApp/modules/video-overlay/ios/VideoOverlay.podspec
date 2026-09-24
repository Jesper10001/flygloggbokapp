Pod::Spec.new do |s|
  s.name           = 'VideoOverlay'
  s.version        = '1.0.0'
  s.summary        = 'Burn a transparent PNG overlay onto a video (AVFoundation Core Animation).'
  s.description    = 'Local Expo module compositing an overlay layer onto a video track and exporting via AVAssetExportSession.'
  s.author         = ''
  s.homepage       = 'https://github.com/blades/video-overlay'
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
