Pod::Spec.new do |s|
  s.name           = 'ICloudSync'
  s.version        = '1.0.0'
  s.summary        = 'Read/write the app backup files in the iCloud ubiquity container.'
  s.description    = 'Local Expo module for iCloud Documents storage: coordinated upload/download of the DB snapshot, photos and manifest, with placeholder-download handling.'
  s.author         = ''
  s.homepage       = 'https://github.com/blades/icloud-sync'
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
