//
//  Pairing.swift
//  Redeem a one-time pairing token (rapt_…) for a long-lived machine token
//  (ramt_…) via POST /api/machines/pair.
//

import Foundation

enum PairingError: LocalizedError {
    case badServerURL
    case server(String)

    var errorDescription: String? {
        switch self {
        case .badServerURL: return "Invalid server URL"
        case .server(let message): return message
        }
    }
}

enum Pairing {
    static func pair(serverURL: String, pairingToken: String) async throws -> String {
        guard let base = URL(string: serverURL), base.host != nil else {
            throw PairingError.badServerURL
        }

        var request = URLRequest(url: base.appendingPathComponent("api/machines/pair"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let name = "\(Host.current().localizedName ?? "Mac") — Notch"
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "token": pairingToken,
            "name": String(name.prefix(100)),
        ])

        let (data, response) = try await URLSession.shared.data(for: request)

        struct PairResponse: Decodable {
            let machineToken: String?
            let error: String?
        }
        let decoded = try? JSONDecoder().decode(PairResponse.self, from: data)

        guard (response as? HTTPURLResponse)?.statusCode == 200,
              let machineToken = decoded?.machineToken else {
            throw PairingError.server(decoded?.error ?? "Pairing failed")
        }
        return machineToken
    }
}
