import Foundation
import Darwin

@objc protocol LayaProbeProtocol {
    func probe(port: Int, udpPort: Int, withReply reply: @escaping (String, Bool, String, Int, String, Bool, String, Int, String) -> Void)
}

final class Canary {
    private let lock = NSLock()
    private var count = 0
    private let fd: Int32
    let port: Int

    init() throws {
        let socketFD = socket(AF_INET, SOCK_STREAM, 0)
        guard socketFD >= 0 else { throw NSError(domain: "Canary", code: Int(errno)) }
        var reuse: Int32 = 1
        _ = setsockopt(socketFD, SOL_SOCKET, SO_REUSEADDR, &reuse, socklen_t(MemoryLayout<Int32>.size))
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = 0
        address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
        let bound = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(socketFD, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
        }
        guard bound == 0 else { _ = Darwin.close(socketFD); throw NSError(domain: "Canary", code: Int(errno)) }
        guard listen(socketFD, 8) == 0 else { _ = Darwin.close(socketFD); throw NSError(domain: "Canary", code: Int(errno)) }
        var actual = sockaddr_in()
        var length = socklen_t(MemoryLayout<sockaddr_in>.size)
        let named = withUnsafeMutablePointer(to: &actual) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(socketFD, $0, &length) }
        }
        guard named == 0 else { _ = Darwin.close(socketFD); throw NSError(domain: "Canary", code: Int(errno)) }
        fd = socketFD
        port = Int(UInt16(bigEndian: actual.sin_port))
        DispatchQueue.global().async { [weak self] in
            while let self {
                let peer = accept(self.fd, nil, nil)
                if peer < 0 { return }
                self.lock.lock(); self.count += 1; self.lock.unlock()
                _ = Darwin.close(peer)
            }
        }
    }

    var accepted: Int {
        lock.lock(); defer { lock.unlock() }
        return count
    }

    func close() { _ = Darwin.close(fd) }
}

final class UdpCanary {
    private let lock = NSLock()
    private var count = 0
    private let fd: Int32
    let port: Int

    init() throws {
        let socketFD = socket(AF_INET, SOCK_DGRAM, 0)
        guard socketFD >= 0 else { throw NSError(domain: "UDPCanary", code: Int(errno)) }
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = 0
        address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
        let bound = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(socketFD, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
        }
        guard bound == 0 else { _ = Darwin.close(socketFD); throw NSError(domain: "UDPCanary", code: Int(errno)) }
        var actual = sockaddr_in()
        var length = socklen_t(MemoryLayout<sockaddr_in>.size)
        let named = withUnsafeMutablePointer(to: &actual) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(socketFD, $0, &length) }
        }
        guard named == 0 else { _ = Darwin.close(socketFD); throw NSError(domain: "UDPCanary", code: Int(errno)) }
        fd = socketFD
        port = Int(UInt16(bigEndian: actual.sin_port))
        DispatchQueue.global().async { [weak self] in
            var buffer = [UInt8](repeating: 0, count: 32)
            while let self {
                let received = recv(self.fd, &buffer, buffer.count, 0)
                if received < 0 { return }
                self.lock.lock(); self.count += 1; self.lock.unlock()
            }
        }
    }

    var received: Int {
        lock.lock(); defer { lock.unlock() }
        return count
    }

    func close() { _ = Darwin.close(fd) }
}

func connectToLoopback(_ port: Int) -> Bool {
    let fd = socket(AF_INET, SOCK_STREAM, 0)
    guard fd >= 0 else { return false }
    defer { _ = Darwin.close(fd) }
    var address = sockaddr_in()
    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    address.sin_family = sa_family_t(AF_INET)
    address.sin_port = in_port_t(port).bigEndian
    address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
    return withUnsafePointer(to: &address) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) == 0
        }
    }
}

func sendUDPToLoopback(_ port: Int) -> (sent: Bool, errorCode: Int, errorText: String) {
    let fd = socket(AF_INET, SOCK_DGRAM, 0)
    guard fd >= 0 else {
        let error = errno
        return (false, Int(error), String(cString: strerror(error)))
    }
    defer { _ = Darwin.close(fd) }
    var address = sockaddr_in()
    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    address.sin_family = sa_family_t(AF_INET)
    address.sin_port = in_port_t(port).bigEndian
    address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
    var bytes: [UInt8] = [0x48, 0x4f, 0x53, 0x54]
    let sent = withUnsafePointer(to: &address) { addressPointer in
        addressPointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { socketAddress in
            bytes.withUnsafeBytes { data in
                sendto(fd, data.baseAddress, data.count, 0, socketAddress, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
    }
    guard sent >= 0 else {
        let error = errno
        return (false, Int(error), String(cString: strerror(error)))
    }
    return (true, 0, "")
}

do {
    guard CommandLine.arguments.count == 3 else { throw NSError(domain: "XPC", code: 9, userInfo: [NSLocalizedDescriptionKey: "Expected XPC service name and network mode arguments"]) }
    let serviceName = CommandLine.arguments[1]
    let expectedAllowed = CommandLine.arguments[2] == "allowed"
    let canary = try Canary()
    let udpCanary = try UdpCanary()
    let hostControl = connectToLoopback(canary.port)
    let hostUDP = sendUDPToLoopback(udpCanary.port)
    Thread.sleep(forTimeInterval: 0.1)
    guard hostControl, canary.accepted == 1, hostUDP.sent, udpCanary.received == 1 else {
        throw NSError(domain: "Canary", code: 1, userInfo: [NSLocalizedDescriptionKey: "Host TCP/UDP positive control failed"])
    }

    let connection = NSXPCConnection(serviceName: serviceName)
    connection.remoteObjectInterface = NSXPCInterface(with: LayaProbeProtocol.self)
    connection.invalidationHandler = {}
    connection.interruptionHandler = {}
    connection.resume()

    let finished = DispatchSemaphore(value: 0)
    var result: (String, Bool, String, Int, String, Bool, String, Int, String)?
    let proxy = connection.remoteObjectProxyWithErrorHandler { error in
        fputs("XPC error: \(error)\n", stderr)
        finished.signal()
    } as? LayaProbeProtocol
    guard let proxy else { throw NSError(domain: "XPC", code: 1) }
    proxy.probe(port: canary.port, udpPort: udpCanary.port) { text, connected, operation, errorCode, errorText, udpSent, udpOperation, udpErrorCode, udpErrorText in
        result = (text, connected, operation, errorCode, errorText, udpSent, udpOperation, udpErrorCode, udpErrorText)
        finished.signal()
    }

    guard finished.wait(timeout: .now() + 10) == .success, let result else {
        connection.invalidate(); canary.close(); udpCanary.close()
        throw NSError(domain: "XPC", code: 2, userInfo: [NSLocalizedDescriptionKey: "XPC call timed out"])
    }
    Thread.sleep(forTimeInterval: 0.15)
    connection.invalidate()
    canary.close()
    udpCanary.close()
    let report: [String: Any] = [
        "hostPositiveControlConnected": hostControl,
        "hostUdpPositiveControlSent": hostUDP.sent,
        "serviceReturnedFixedText": result.0 == "synthetic inference service reply",
        "serviceConnectedToLoopback": result.1,
        "serviceTcpFailureOperation": result.2,
        "serviceTcpErrno": result.3,
        "serviceTcpError": result.4,
        "loopbackTcpCanaryConnections": canary.accepted,
        "serviceSentUdp": result.5,
        "serviceUdpFailureOperation": result.6,
        "serviceUdpErrno": result.7,
        "serviceUdpError": result.8,
        "loopbackUdpCanaryDatagrams": udpCanary.received,
        "serviceReply": result.0,
        "expectedNetworkClient": expectedAllowed,
        "result": expectedAllowed
            ? (result.1 && canary.accepted == 2 && result.5 && udpCanary.received == 2 ? "network-client-positive-control-passed" : "network-client-positive-control-failed")
            : (!result.1 && canary.accepted == 1 && !result.5 && udpCanary.received == 1 ? "service-network-denial-observed" : "service-network-denial-failed"),
    ]
    let data = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
    print(String(decoding: data, as: UTF8.self))
    if report["result"] as? String == "network-client-positive-control-failed" || report["result"] as? String == "service-network-denial-failed" { exit(1) }
} catch {
    fputs("Probe failed: \(error)\n", stderr)
    exit(1)
}
