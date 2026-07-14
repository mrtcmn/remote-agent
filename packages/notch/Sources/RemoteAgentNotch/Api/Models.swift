//
//  Models.swift
//  Codable mirrors of the API's NotificationRecord + websocket frames.
//

import Foundation

/// Type-erased JSON for the metadata blob.
enum JSONValue: Codable, Hashable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value")
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }

    var stringValue: String? {
        if case .string(let value) = self { return value }
        return nil
    }

    var boolValue: Bool? {
        if case .bool(let value) = self { return value }
        return nil
    }
}

struct NotificationAction: Codable, Hashable {
    let label: String
    let action: String

    private enum CodingKeys: String, CodingKey {
        case label, action
    }
}

struct NotificationRecord: Codable, Identifiable, Hashable {
    let id: String
    let sessionId: String?
    let terminalId: String?
    let type: String
    let title: String
    let body: String
    let metadata: [String: JSONValue]?
    let actions: [NotificationAction]?
    let priority: String?
    let status: String?
    let createdAt: String?

    private enum CodingKeys: String, CodingKey {
        case id, sessionId, terminalId, type, title, body, metadata, actions, priority, status, createdAt
    }

    /// Prompts the user must answer (shown with review styling + action buttons).
    var needsReview: Bool {
        type == "permission_request" || type == "user_input_required"
    }

    var projectName: String? {
        metadata?["projectName"]?.stringValue
    }

    var freeformAllowed: Bool {
        metadata?["freeformAllowed"]?.boolValue
            ?? (actions ?? []).contains { $0.action == "reply" }
    }
}

// MARK: - Websocket frames

struct FrameHead: Decodable {
    let type: String
    let id: String?
}

struct SnapshotFrame: Decodable {
    let data: [NotificationRecord]
}

struct NotificationFrame: Decodable {
    let data: NotificationRecord
    let userActive: Bool?
}
