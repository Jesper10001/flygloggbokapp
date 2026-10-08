import ExpoModulesCore
import Foundation
import UIKit
import CryptoKit
import Security
import Photos

// iCloud Documents-synk: läser/skriver appens backup-filer (DB-snapshot + foton + manifest) i appens
// ubiquity-container (<container>/Documents/…). iCloud laddar upp/ned automatiskt; vi koordinerar
// I/O med NSFileCoordinator och triggar nedladdning av "placeholders" (ej nedladdade filer på en ny
// enhet). iOS-only — kräver iCloud-entitlement + dev/EAS-build (ej Expo Go).
public class ICloudSyncModule: Module {
  private let io = DispatchQueue(label: "app.blades.icloudsync.io", qos: .utility)

  public func definition() -> ModuleDefinition {
    Name("ICloudSync")

    // Är användaren inloggad i iCloud och är containern tillgänglig?
    AsyncFunction("accountStatus") { (promise: Promise) in
      self.io.async {
        let signedIn = FileManager.default.ubiquityIdentityToken != nil
        let container = ICloudSyncModule.docsURL() != nil
        promise.resolve(["available": signedIn && container, "signedIn": signedIn])
      }
    }

    // Enhetsnamn för "senast säkerhetskopierad från …" i storage-vyn (generiskt "iPhone"/"iPad"
    // på moderna iOS utan särskild entitlement — räcker för att skilja enheter åt).
    AsyncFunction("deviceName") { (promise: Promise) in
      promise.resolve(UIDevice.current.name)
    }

    AsyncFunction("containerURL") { (promise: Promise) in
      self.io.async {
        guard let base = ICloudSyncModule.docsURL() else { promise.reject("E_NO_ICLOUD", "iCloud is not available"); return }
        promise.resolve(base.path)
      }
    }

    // Kopiera en lokal fil → containern (relativePath under Documents). iCloud laddar upp automatiskt.
    AsyncFunction("upload") { (localPath: String, relativePath: String, promise: Promise) in
      self.io.async {
        guard let base = ICloudSyncModule.docsURL() else { promise.reject("E_NO_ICLOUD", "iCloud is not available"); return }
        let src = ICloudSyncModule.fileURL(localPath)
        let dst = base.appendingPathComponent(relativePath)
        do {
          try FileManager.default.createDirectory(at: dst.deletingLastPathComponent(), withIntermediateDirectories: true)
        } catch {
          promise.reject("E_UPLOAD", error.localizedDescription); return
        }
        var coordError: NSError?
        var thrown: Error?
        NSFileCoordinator().coordinate(writingItemAt: dst, options: .forReplacing, error: &coordError) { url in
          do {
            if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
            try FileManager.default.copyItem(at: src, to: url)
          } catch { thrown = error }
        }
        if let e = coordError { promise.reject("E_UPLOAD", e.localizedDescription); return }
        if let e = thrown { promise.reject("E_UPLOAD", e.localizedDescription); return }
        promise.resolve(dst.path)
      }
    }

    // Ladda ned (om placeholder) och kopiera containern-filen → localPath.
    AsyncFunction("download") { (relativePath: String, localPath: String, promise: Promise) in
      self.io.async {
        guard let base = ICloudSyncModule.docsURL() else { promise.reject("E_NO_ICLOUD", "iCloud is not available"); return }
        let remote = base.appendingPathComponent(relativePath)
        let dst = ICloudSyncModule.fileURL(localPath)
        try? FileManager.default.startDownloadingUbiquitousItem(at: remote)
        var coordError: NSError?
        var thrown: Error?
        // Koordinerad läsning blockerar tills filen är nedladdad och tillgänglig.
        NSFileCoordinator().coordinate(readingItemAt: remote, options: [], error: &coordError) { url in
          do {
            try FileManager.default.createDirectory(at: dst.deletingLastPathComponent(), withIntermediateDirectories: true)
            if FileManager.default.fileExists(atPath: dst.path) { try FileManager.default.removeItem(at: dst) }
            try FileManager.default.copyItem(at: url, to: dst)
          } catch { thrown = error }
        }
        if let e = coordError { promise.reject("E_DOWNLOAD", e.localizedDescription); return }
        if let e = thrown { promise.reject("E_DOWNLOAD", e.localizedDescription); return }
        promise.resolve(dst.path)
      }
    }

    // Metadata om en fil i containern (finns/storlek/mtime/nedladdad).
    AsyncFunction("stat") { (relativePath: String, promise: Promise) in
      self.io.async {
        guard let base = ICloudSyncModule.docsURL() else { promise.reject("E_NO_ICLOUD", "iCloud is not available"); return }
        promise.resolve(ICloudSyncModule.statOf(base.appendingPathComponent(relativePath)))
      }
    }

    // Lista filnamn i en mapp i containern (normaliserar ej-nedladdade ".namn.icloud"-placeholders).
    AsyncFunction("list") { (relativeDir: String, promise: Promise) in
      self.io.async {
        guard let base = ICloudSyncModule.docsURL() else { promise.reject("E_NO_ICLOUD", "iCloud is not available"); return }
        let dir = relativeDir.isEmpty ? base : base.appendingPathComponent(relativeDir)
        let fm = FileManager.default
        guard let items = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil, options: []) else {
          promise.resolve([String]()); return
        }
        var names = Set<String>()
        for u in items {
          var name = u.lastPathComponent
          if name.hasPrefix(".") && name.hasSuffix(".icloud") {
            name = String(name.dropFirst().dropLast(7)) // ".namn.icloud" → "namn"
          }
          names.insert(name)
        }
        promise.resolve(Array(names))
      }
    }

    AsyncFunction("remove") { (relativePath: String, promise: Promise) in
      self.io.async {
        guard let base = ICloudSyncModule.docsURL() else { promise.reject("E_NO_ICLOUD", "iCloud is not available"); return }
        let target = base.appendingPathComponent(relativePath)
        var coordError: NSError?
        var thrown: Error?
        NSFileCoordinator().coordinate(writingItemAt: target, options: .forDeleting, error: &coordError) { url in
          do { if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) } }
          catch { thrown = error }
        }
        if let e = coordError { promise.reject("E_REMOVE", e.localizedDescription); return }
        if let e = thrown { promise.reject("E_REMOVE", e.localizedDescription); return }
        promise.resolve(true)
      }
    }

    // ── DB-krypteringsnyckel i iCloud Keychain (synchronizable) ──────────────────
    // Lagrar/hämtar SQLCipher-nyckeln i Keychain med kSecAttrSynchronizable=true → iOS synkar den
    // via iCloud Keychain (E2E-krypterad av Apple). Gör att en NY enhet kan dekryptera backup-snapshoten.
    // ADD-IF-ABSENT: skriver bara om ingen synkad nyckel finns. Skriver ALDRIG över en befintlig —
    // annars kan en ny/långsam enhet råka ersätta kontots kanoniska nyckel och göra backupen oläsbar.
    AsyncFunction("setDbKey") { (key: String, promise: Promise) in
      self.io.async {
        let add: [String: Any] = [
          kSecClass as String: kSecClassGenericPassword,
          kSecAttrAccount as String: ICloudSyncModule.keyAccount,
          kSecAttrService as String: ICloudSyncModule.keyService,
          kSecValueData as String: key.data(using: .utf8)!,
          kSecAttrSynchronizable as String: kCFBooleanTrue!,
          kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]
        let status = SecItemAdd(add as CFDictionary, nil)
        if status == errSecSuccess || status == errSecDuplicateItem { promise.resolve(true) }
        else { promise.reject("E_KEYCHAIN", "SecItemAdd failed: \(status)") }
      }
    }

    AsyncFunction("getDbKey") { (promise: Promise) in
      self.io.async {
        let query: [String: Any] = [
          kSecClass as String: kSecClassGenericPassword,
          kSecAttrAccount as String: ICloudSyncModule.keyAccount,
          kSecAttrService as String: ICloudSyncModule.keyService,
          kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
          kSecReturnData as String: true,
          kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &out)
        if status == errSecSuccess, let d = out as? Data, let s = String(data: d, encoding: .utf8) {
          promise.resolve(s)
        } else {
          promise.resolve(nil) // saknas → anroparen faller tillbaka/genererar
        }
      }
    }

    // ── Bekräfta att en fil FAKTISKT laddats upp till iCloud (inte bara kopierats in i containern) ──
    // iOS laddar upp asynkront; detta pollar ubiquitousItemIsUploaded tills klart eller timeout.
    AsyncFunction("confirmUploaded") { (relativePath: String, timeoutMs: Int, promise: Promise) in
      self.io.async {
        guard let base = ICloudSyncModule.docsURL() else { promise.reject("E_NO_ICLOUD", "iCloud is not available"); return }
        let url = base.appendingPathComponent(relativePath)
        let deadline = Date().addingTimeInterval(Double(timeoutMs) / 1000.0)
        func uploaded() -> Bool {
          let v = try? url.resourceValues(forKeys: [.ubiquitousItemIsUploadedKey])
          return v?.ubiquitousItemIsUploaded ?? false
        }
        while Date() < deadline {
          if uploaded() { promise.resolve(true); return }
          Thread.sleep(forTimeInterval: 0.5)
        }
        promise.resolve(uploaded())
      }
    }

    // SHA-256 (hex) av en lokal fil → binder manifest ↔ snapshot så restore kan verifiera integritet.
    AsyncFunction("sha256") { (localPath: String, promise: Promise) in
      self.io.async {
        let url = ICloudSyncModule.fileURL(localPath)
        guard let data = try? Data(contentsOf: url) else { promise.reject("E_HASH", "Could not read file for hashing"); return }
        let digest = SHA256.hash(data: data)
        promise.resolve(digest.map { String(format: "%02x", $0) }.joined())
      }
    }

    // ── Foto-referenser: översätt lokala PHAsset-id:n ↔ stabila iCloud-foton-id:n (PHCloudIdentifier) ──
    // Lokala identifierare är per-enhet; cloud-id:t är stabilt mellan enheter (när iCloud-foton är på).
    // Vid backup lagrar vi cloud-id:t; vid restore översätter vi tillbaka till den NYA enhetens lokal-id.
    // Tomt resultat om iCloud-foton är av eller behörighet saknas (hanteras tyst av anroparen).
    AsyncFunction("photoCloudIds") { (localIds: [String], promise: Promise) in
      self.io.async {
        if #available(iOS 15, *) {
          let mapping = PHPhotoLibrary.shared().cloudIdentifierMappings(forLocalIdentifiers: localIds)
          var out: [String: String] = [:]
          for (lid, result) in mapping {
            if case .success(let cid) = result { out[lid] = cid.stringValue }
          }
          promise.resolve(out)
        } else {
          promise.resolve([String: String]())
        }
      }
    }

    AsyncFunction("photoLocalIds") { (cloudIds: [String], promise: Promise) in
      self.io.async {
        if #available(iOS 15, *) {
          let cids = cloudIds.map { PHCloudIdentifier(stringValue: $0) }
          let mapping = PHPhotoLibrary.shared().localIdentifierMappings(forCloudIdentifiers: cids)
          var out: [String: String] = [:]
          for (cid, result) in mapping {
            if case .success(let lid) = result { out[cid.stringValue] = lid }
          }
          promise.resolve(out)
        } else {
          promise.resolve([String: String]())
        }
      }
    }
  }

  // ── Hjälpare ────────────────────────────────────────────────────────────────
  // Keychain-identitet för den synkade DB-nyckeln (eget service-namn, inte expo-secure-stores).
  private static let keyAccount = "blades_db_key_v1"
  private static let keyService = "app.blades.dbkey.synced"

  // <container>/Documents — konventionell plats för användarens dokument (synkas + syns i Filer).
  private static func docsURL() -> URL? {
    guard let c = FileManager.default.url(forUbiquityContainerIdentifier: nil) else { return nil }
    return c.appendingPathComponent("Documents")
  }

  private static func fileURL(_ s: String) -> URL {
    if s.hasPrefix("file://") {
      return URL(string: s) ?? URL(fileURLWithPath: s.replacingOccurrences(of: "file://", with: ""))
    }
    return URL(fileURLWithPath: s)
  }

  private static func statOf(_ url: URL) -> [String: Any] {
    let fm = FileManager.default
    // Nedladdad fil finns på path:en; ej nedladdad finns som placeholder ".namn.icloud".
    let placeholder = url.deletingLastPathComponent().appendingPathComponent("." + url.lastPathComponent + ".icloud")
    let existsReal = fm.fileExists(atPath: url.path)
    let existsPlaceholder = fm.fileExists(atPath: placeholder.path)
    if !existsReal && !existsPlaceholder { return ["exists": false] }
    var size = 0
    var mtime: Double = 0
    var downloaded = existsReal
    if let v = try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey, .ubiquitousItemDownloadingStatusKey]) {
      size = v.fileSize ?? 0
      if let d = v.contentModificationDate { mtime = d.timeIntervalSince1970 * 1000 }
      if let st = v.ubiquitousItemDownloadingStatus { downloaded = (st == .current) }
    }
    return ["exists": true, "size": size, "mtime": mtime, "downloaded": downloaded]
  }
}
