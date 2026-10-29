import Foundation
import Darwin

@objc protocol LayaProbeProtocol {
    func probe(port: Int, udpPort: Int, withReply reply: @escaping (String, Bool, String, Int, String, Bool, String, Int, String) -> Void)
}

final class ProbeService: NSObject, LayaProbeProtocol {
    func probe(port: Int, udpPort: Int, withReply reply: @escaping (String, Bool, String, Int, String, Bool, String, Int, String) -> Void) {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else {
            let error = errno
            let udp = sendSyntheticUDP(to: udpPort)
            reply("synthetic inference service reply", false, "socket", Int(error), String(cString: strerror(error)), udp.sent, udp.operation, udp.errorCode, udp.errorText)
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
        reply("synthetic inference service reply", connected, connected ? "none" : "connect", Int(tcpError), tcpError == 0 ? "" : String(cString: strerror(tcpError)), udp.sent, udp.operation, udp.errorCode, udp.errorText)
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
        var bytes: [UInt8] = [0x4c, 0x41, 0x59, 0x41]
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
