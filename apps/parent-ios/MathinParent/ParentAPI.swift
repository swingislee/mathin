import Foundation
import Security

struct ParentSession: Codable {
    let accessToken: String
    let refreshToken: String
    let expiresAt: Double
}

struct ParentAPIError: LocalizedError {
    let code: String
    var errorDescription: String? { tr("error_" + code.lowercased()) }
}

private struct ParentAPIErrorBody: Decodable { let code: String }

private final class ParentTransportDelegate: NSObject, URLSessionTaskDelegate {
    // 登录、Bearer 与附件只发往配置的服务；HTTP 重定向不携带这些请求。
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

// 会话仅存入设备 Keychain，并按 API origin 隔离。业务界面不持有服务端密钥。
private struct ParentKeychain {
    let service: String
    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "session"]
    }
    func read() -> ParentSession? {
        var lookup = query
        lookup[kSecReturnData as String] = true
        lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(lookup as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(ParentSession.self, from: data)
    }
    func save(_ session: ParentSession?) throws {
        guard let session else { SecItemDelete(query as CFDictionary); return }
        let data = try JSONEncoder().encode(session)
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var item = query
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw ParentAPIError(code: "STORAGE") }
        } else if status != errSecSuccess { throw ParentAPIError(code: "STORAGE") }
    }
}

@MainActor
final class ParentAPI {
    let origin: URL?
    private let transport: URLSession
    private var session: ParentSession?
    private var refreshing: Task<ParentSession, Error>?
    private var generation = 0
    private let keychain: ParentKeychain
    var hasSession: Bool { session != nil }

    init() {
        let raw = (Bundle.main.object(forInfoDictionaryKey: "MathinAPIOrigin") as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        origin = Self.validOrigin(raw)
        keychain = ParentKeychain(service: "club.mathin.parent.session." + (origin?.absoluteString ?? "unconfigured"))
        session = origin == nil ? nil : keychain.read()
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 120
        config.httpCookieStorage = nil
        config.urlCache = nil
        transport = URLSession(configuration: config, delegate: ParentTransportDelegate(), delegateQueue: nil)
    }

    static func validOrigin(_ raw: String) -> URL? {
        #if DEBUG
        return ParentEndpoint.origin(raw, allowLocalHTTP: true)
        #else
        return ParentEndpoint.origin(raw, allowLocalHTTP: false)
        #endif
    }

    private func url(_ path: String, query: [URLQueryItem] = []) throws -> URL {
        guard let origin, var parts = URLComponents(url: origin.appendingPathComponent("api/v1/parent/" + path), resolvingAgainstBaseURL: false)
        else { throw ParentAPIError(code: "CONFIG_REQUIRED") }
        parts.queryItems = query.isEmpty ? nil : query
        guard let url = parts.url else { throw ParentAPIError(code: "CONFIG_REQUIRED") }
        return url
    }

    private func send<T: Decodable>(_ request: URLRequest, as type: T.Type = T.self) async throws -> T {
        let requestGeneration = generation
        let (data, response): (Data, URLResponse)
        do { (data, response) = try await transport.data(for: request) }
        catch { throw ParentAPIError(code: "NETWORK") }
        guard generation == requestGeneration else { throw ParentAPIError(code: "UNAUTHENTICATED") }
        guard let http = response as? HTTPURLResponse else { throw ParentAPIError(code: "UNAVAILABLE") }
        guard (200..<300).contains(http.statusCode) else {
            let code = (try? JSONDecoder().decode(ParentAPIErrorBody.self, from: data).code) ?? "UNAVAILABLE"
            throw ParentAPIError(code: code)
        }
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw ParentAPIError(code: "INVALID_RESPONSE") }
    }

    private func auth(_ body: [String: String]) async throws -> ParentSession {
        var request = URLRequest(url: try url("auth"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        return try await send(request)
    }

    func login(identifier: String, password: String) async throws {
        clearSession()
        let value = try await auth(["action": "login", "identifier": identifier.trimmingCharacters(in: .whitespacesAndNewlines), "password": password])
        try keychain.save(value)
        session = value
    }

    private func token() async throws -> String {
        guard let current = session else { throw ParentAPIError(code: "UNAUTHENTICATED") }
        if current.expiresAt > Date().timeIntervalSince1970 + 60 { return current.accessToken }
        if let refreshing { return try await refreshing.value.accessToken }
        let epoch = generation
        let pending = Task { try await self.auth(["action": "refresh", "refreshToken": current.refreshToken]) }
        refreshing = pending
        defer { if generation == epoch { refreshing = nil } }
        do {
            let value = try await pending.value
            guard session?.refreshToken == current.refreshToken else { throw ParentAPIError(code: "UNAUTHENTICATED") }
            try keychain.save(value)
            session = value
            return value.accessToken
        } catch {
            if generation == epoch, session?.refreshToken == current.refreshToken,
               (error as? ParentAPIError)?.code == "UNAUTHENTICATED" { clearSession() }
            throw error
        }
    }

    func get<T: Decodable>(_ resource: String, query: [URLQueryItem] = []) async throws -> T {
        var request = URLRequest(url: try url("portal", query: [URLQueryItem(name: "resource", value: resource)] + query))
        request.setValue("Bearer " + (try await token()), forHTTPHeaderField: "Authorization")
        return try await send(request)
    }

    func learning<T: Decodable>(participantID: String, from: Date? = nil, to: Date? = nil) async throws -> T {
        var query = [URLQueryItem(name: "participant", value: participantID)]
        if let from, let to {
            query += [URLQueryItem(name: "from", value: ParentDate.iso(from)), URLQueryItem(name: "to", value: ParentDate.iso(to))]
        }
        var request = URLRequest(url: try url("learning", query: query))
        request.setValue("Bearer " + (try await token()), forHTTPHeaderField: "Authorization")
        return try await send(request)
    }

    func post<T: Decodable>(_ body: some Encodable, path: String = "portal") async throws -> T {
        var request = URLRequest(url: try url(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer " + (try await token()), forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(body)
        return try await send(request)
    }

    func upload(_ data: Data, assignmentID: String, participantID: String) async throws -> ParentMedia {
        guard data.count <= 12 * 1024 * 1024 else { throw ParentAPIError(code: "TOO_LARGE") }
        let boundary = "Mathin-" + UUID().uuidString
        var request = URLRequest(url: try url("media"))
        request.httpMethod = "POST"
        request.timeoutInterval = 120
        request.setValue("Bearer " + (try await token()), forHTTPHeaderField: "Authorization")
        request.setValue(assignmentID, forHTTPHeaderField: "x-assignment-id")
        request.setValue(participantID, forHTTPHeaderField: "x-participant-id")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        var body = Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"practice.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n".utf8)
        body.append(data)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        request.httpBody = body
        return try await send(request)
    }

    func mediaURL(id: String) async throws -> URL {
        struct Location: Decodable { let url: String }
        var request = URLRequest(url: try url("media", query: [URLQueryItem(name: "id", value: id)]))
        request.setValue("Bearer " + (try await token()), forHTTPHeaderField: "Authorization")
        let location: Location = try await send(request)
        guard let origin, let resolved = URL(string: location.url, relativeTo: origin)?.absoluteURL,
              resolved.scheme == origin.scheme, resolved.host == origin.host, resolved.port == origin.port
        else { throw ParentAPIError(code: "INVALID_RESPONSE") }
        return resolved
    }

    func logout() async {
        let oldToken = session?.accessToken
        clearSession()
        if let oldToken, var request = try? URLRequest(url: url("auth")) {
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("Bearer " + oldToken, forHTTPHeaderField: "Authorization")
            request.httpBody = Data("{\"action\":\"logout\"}".utf8)
            let _: [String: Bool]? = try? await send(request)
        }
    }

    func clearSession() {
        generation += 1
        refreshing?.cancel()
        refreshing = nil
        session = nil
        try? keychain.save(nil)
    }
}
