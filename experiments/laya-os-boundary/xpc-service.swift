import Foundation
import Darwin
import CryptoKit
import JavaScriptCore

@objc protocol LayaProbeProtocol {
    func probe(port: Int, udpPort: Int, withReply reply: @escaping (String, Bool, String, Int, String, Bool, String, Int, String) -> Void)
    func inspectModel(_ bytes: NSData, expectedDigest: NSData, withReply reply: @escaping (String, Int, String, String) -> Void)
    func inspectOutsideFixture(withReply reply: @escaping (Bool, Int, String) -> Void)
    func beginPinnedModelUpload(modelBytes: Int, vocab: NSData, withReply reply: @escaping (Bool, String) -> Void)
    func appendPinnedModelChunk(index: Int, bytes: NSData, withReply reply: @escaping (Bool, String) -> Void)
    func finishPinnedModelUpload(withReply reply: @escaping (Bool, String) -> Void)
    func inferSyntheticText(_ text: String, withReply reply: @escaping (String) -> Void)
}

final class ProbeService: NSObject, LayaProbeProtocol {
    private let maxModelBytes = 4096
    private let pinnedModelBytes = 90_868_376
    private let pinnedModelSHA = "53aa51172d142c89d9012cce15ae4d6cc0ca6895895114379cacb4fab128d9db"
    private let pinnedVocabBytes = 231_508
    private let pinnedVocabSHA = "07eced375cec144d27c900241f3e339478dec958f92fddbc551f295c992038a3"
    private let maxTransferChunkBytes = 1_048_576
    private let outsideFixturePath = __LAYA_PROBE_FIXTURE_PATH__
    private let syntheticInferenceText = "The quick brown fox jumps over the lazy dog."
    private var transferredModel = Data()
    private var transferredVocab = Data()
    private var nextChunkIndex = 0
    private var modelVerified = false
    private var vocabVerified = false

    func probe(port: Int, udpPort: Int, withReply reply: @escaping (String, Bool, String, Int, String, Bool, String, Int, String) -> Void) {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else {
            let error = errno
            let udp = sendSyntheticUDP(to: udpPort)
            reply("synthetic XPC control reply", false, "socket", Int(error), String(cString: strerror(error)), udp.sent, udp.operation, udp.errorCode, udp.errorText)
            return
        }
        defer { _ = Darwin.close(fd) }
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = in_port_t(port).bigEndian
        address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
        let connected = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) == 0
            }
        }
        let tcpError = connected ? 0 : errno
        let udp = sendSyntheticUDP(to: udpPort)
        reply("synthetic XPC control reply", connected, connected ? "none" : "connect", Int(tcpError), tcpError == 0 ? "" : String(cString: strerror(tcpError)), udp.sent, udp.operation, udp.errorCode, udp.errorText)
    }

    private func sendSyntheticUDP(to port: Int) -> (sent: Bool, operation: String, errorCode: Int, errorText: String) {
        let fd = socket(AF_INET, SOCK_DGRAM, 0)
        guard fd >= 0 else {
            let error = errno
            return (false, "socket", Int(error), String(cString: strerror(error)))
        }
        defer { _ = Darwin.close(fd) }
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = in_port_t(port).bigEndian
        address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
        let bytes: [UInt8] = [0x4c, 0x41, 0x59, 0x41]
        let sent = withUnsafePointer(to: &address) { addressPointer in
            addressPointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { socketAddress in
                bytes.withUnsafeBytes { data in
                    sendto(fd, data.baseAddress, data.count, 0, socketAddress, socklen_t(MemoryLayout<sockaddr_in>.size))
                }
            }
        }
        guard sent >= 0 else {
            let error = errno
            return (false, "sendto", Int(error), String(cString: strerror(error)))
        }
        return (true, "none", 0, "")
    }

    func inspectModel(_ bytes: NSData, expectedDigest: NSData, withReply reply: @escaping (String, Int, String, String) -> Void) {
        guard bytes.length > 0 else {
            reply("rejected-empty", 0, "", "empty-payload")
            return
        }
        guard bytes.length <= maxModelBytes else {
            reply("rejected-size", bytes.length, "", "")
            return
        }
        guard expectedDigest.length == Int(SHA256.Digest.byteCount) else {
            reply("rejected-digest", bytes.length, "", "invalid-digest-length")
            return
        }
        let data = bytes as Data
        let digest = Data(SHA256.hash(data: data))
        guard digest == (expectedDigest as Data) else {
            reply("rejected-digest", bytes.length, digest.map { String(format: "%02x", $0) }.joined(), "digest-mismatch")
            return
        }
        // Bounded synthetic work demonstrates that validated bytes reached the
        // isolated service; no model files or arbitrary user input are loaded.
        let checksum = data.reduce(UInt64(0)) { ($0 + UInt64($1)) & 0xffff_ffff }
        reply("accepted", bytes.length, digest.map { String(format: "%02x", $0) }.joined(), String(checksum))
    }

    func inspectOutsideFixture(withReply reply: @escaping (Bool, Int, String) -> Void) {
        let fd = open(outsideFixturePath, O_RDONLY)
        guard fd >= 0 else {
            let error = errno
            reply(false, Int(error), String(cString: strerror(error)))
            return
        }
        _ = Darwin.close(fd)
        reply(true, 0, "readable")
    }

    func beginPinnedModelUpload(modelBytes: Int, vocab: NSData, withReply reply: @escaping (Bool, String) -> Void) {
        guard modelBytes == pinnedModelBytes, vocab.length == pinnedVocabBytes else {
            reply(false, "pinned-size-mismatch")
            return
        }
        let vocabData = vocab as Data
        guard sha256(vocabData) == pinnedVocabSHA else {
            reply(false, "pinned-vocab-digest-mismatch")
            return
        }
        transferredModel = Data(capacity: pinnedModelBytes)
        transferredVocab = vocabData
        nextChunkIndex = 0
        modelVerified = false
        vocabVerified = false
        reply(true, "upload-started")
    }

    func appendPinnedModelChunk(index: Int, bytes: NSData, withReply reply: @escaping (Bool, String) -> Void) {
        guard index == nextChunkIndex, bytes.length > 0, bytes.length <= maxTransferChunkBytes else {
            reply(false, "invalid-chunk-index-or-size")
            return
        }
        guard transferredModel.count <= pinnedModelBytes - bytes.length else {
            reply(false, "model-upload-exceeds-pinned-size")
            return
        }
        transferredModel.append(bytes as Data)
        nextChunkIndex += 1
        reply(true, "chunk-accepted")
    }

    func finishPinnedModelUpload(withReply reply: @escaping (Bool, String) -> Void) {
        guard transferredModel.count == pinnedModelBytes, transferredVocab.count == pinnedVocabBytes else {
            reply(false, "pinned-size-mismatch")
            return
        }
        guard sha256(transferredModel) == pinnedModelSHA, sha256(transferredVocab) == pinnedVocabSHA else {
            transferredModel.removeAll(keepingCapacity: false)
            transferredVocab.removeAll(keepingCapacity: false)
            reply(false, "pinned-digest-mismatch")
            return
        }
        modelVerified = true
        vocabVerified = true
        reply(true, "pinned-bytes-verified")
    }

    func inferSyntheticText(_ text: String, withReply reply: @escaping (String) -> Void) {
        guard modelVerified, vocabVerified else { reply("error:model-not-verified"); return }
        guard text == syntheticInferenceText, text.utf8.count <= 200 else { reply("error:text-not-allowed"); return }
        guard let vocabText = String(data: transferredVocab, encoding: .utf8) else { reply("error:vocab-utf8"); return }
        guard let bundleURL = Bundle.main.url(forResource: "laya-encoder", withExtension: "js"),
              let bundleSource = try? String(contentsOf: bundleURL, encoding: .utf8) else {
            reply("error:bundled-encoder-unavailable"); return
        }
        guard let context = JSContext() else { reply("error:jsc-context"); return }
        var scriptError: String?
        context.exceptionHandler = { _, value in scriptError = value?.toString() ?? "JavaScript exception" }
        _ = context.evaluateScript(bundleSource)
        if let scriptError { reply("error:bundle-evaluation:\(scriptError.prefix(160))"); return }
        guard let infer = context.objectForKeyedSubscript("layaRunInference"), !infer.isUndefined else {
            reply("error:inference-entry-missing"); return
        }

        var jsException: JSValueRef?
        let jsModel: JSValue? = transferredModel.withUnsafeBytes { source in
            guard let sourceBase = source.baseAddress, source.count == pinnedModelBytes,
                  let owned = malloc(source.count) else { return nil }
            memcpy(owned, sourceBase, source.count)
            let deallocator: JSTypedArrayBytesDeallocator = { bytes, _ in
                if let bytes { free(bytes) }
            }
            guard let typedArray = JSObjectMakeTypedArrayWithBytesNoCopy(
                context.jsGlobalContextRef,
                kJSTypedArrayTypeUint8Array,
                owned,
                source.count,
                deallocator,
                nil,
                &jsException
            ) else { return nil }
            return JSValue(jsValueRef: typedArray, in: context)
        }
        guard let jsModel else {
            reply("error:jsc-model-buffer:\(jsException.map { JSValue(jsValueRef: $0, in: context)?.toString() ?? "exception" } ?? "allocation")")
            return
        }
        guard let result = infer.call(withArguments: [jsModel, vocabText, text]), !result.isUndefined,
              let json = result.toString(), let jsonData = json.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any],
              let tokenIDs = object["tokenIds"] as? [Int],
              let vectorNumbers = object["vector"] as? [NSNumber], vectorNumbers.count == 384 else {
            reply("error:invalid-inference-output:\(scriptError ?? "shape")")
            return
        }
        let vector = vectorNumbers.map(\.doubleValue)
        guard vector.allSatisfy(\.isFinite) else { reply("error:nonfinite-vector"); return }
        let norm = sqrt(vector.reduce(0.0) { $0 + $1 * $1 })
        guard abs(norm - 1) < 0.0001 else { reply("error:vector-not-unit-length"); return }
        let floatVector = vector.map(Float.init)
        let vectorData = floatVector.withUnsafeBytes { Data($0) }
        let digest = sha256(vectorData)
        let summary: [String: Any] = [
            "status": "inference-complete",
            "tokenIDs": tokenIDs,
            "vectorLength": vector.count,
            "vectorNorm": norm,
            "vectorSHA256Float32NativeBytes": digest,
            "vector": vector,
        ]
        guard let summaryData = try? JSONSerialization.data(withJSONObject: summary),
              let summaryText = String(data: summaryData, encoding: .utf8) else {
            reply("error:summary-serialization"); return
        }
        reply(summaryText)
    }

    private func sha256(_ data: Data) -> String {
        Data(SHA256.hash(data: data)).map { String(format: "%02x", $0) }.joined()
    }
}

final class ListenerDelegate: NSObject, NSXPCListenerDelegate {
    private let service = ProbeService()

    func listener(_ listener: NSXPCListener, shouldAcceptNewConnection connection: NSXPCConnection) -> Bool {
        connection.exportedInterface = NSXPCInterface(with: LayaProbeProtocol.self)
        connection.exportedObject = service
        connection.resume()
        return true
    }
}

let listener = NSXPCListener.service()
let delegate = ListenerDelegate()
listener.delegate = delegate
listener.resume()
RunLoop.main.run()
