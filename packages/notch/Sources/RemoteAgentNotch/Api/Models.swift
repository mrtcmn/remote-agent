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

    var doubleValue: Double? {
        if case .number(let value) = self { return value }
        return nil
    }

    var intValue: Int? {
        if case .number(let value) = self { return Int(value) }
        return nil
    }
}

/// Shared parser for the ISO-8601 timestamps the API stamps into metadata
/// (`startedAt` / `lastActiveAt`) and the record's `createdAt`. Handles both
/// the fractional-seconds form (`.toISOString()`) and the plain form.
enum ISOTime {
    private static let withFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
    private static let plain = ISO8601DateFormatter()

    static func parse(_ s: String?) -> Date? {
        guard let s else { return nil }
        return withFraction.date(from: s) ?? plain.date(from: s)
    }
}

struct NotificationAction: Codable, Hashable {
    let label: String
    let action: String

    private enum CodingKeys: String, CodingKey {
        case label, action
    }
}

/// The four states a session row can be in. Colour lives in the UI layer
/// (StatusKind+Color) so this stays Foundation-only.
enum StatusKind {
    case running   // blue  — working
    case review    // amber — needs you (permission / input)
    case done      // green — task complete
    case error     // red   — failed

    var symbol: String {
        switch self {
        case .running: return "circle.lefthalf.filled"
        case .review:  return "exclamationmark.circle.fill"
        case .done:    return "checkmark.circle.fill"
        case .error:   return "xmark.octagon.fill"
        }
    }

    var label: String {
        switch self {
        case .running: return "working"
        case .review:  return "needs you"
        case .done:    return "done"
        case .error:   return "failed"
        }
    }

    /// Section header in the grouped list.
    var groupLabel: String {
        switch self {
        case .running: return "WORKING"
        case .review:  return "NEEDS YOU"
        case .done:    return "DONE"
        case .error:   return "FAILED"
        }
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
    /// Origin machine (aggregate tags these). nil / "self" → this machine.
    let machineId: String?
    let machineName: String?

    private enum CodingKeys: String, CodingKey {
        case id, sessionId, terminalId, type, title, body, metadata, actions, priority, status, createdAt, machineId, machineName
    }

    /// A notification from a paired remote machine (not this one).
    var isRemote: Bool {
        guard let machineId, machineId != "self" else { return false }
        return true
    }

    /// Prompts the user must answer (shown with review styling + action buttons).
    var needsReview: Bool {
        type == "permission_request" || type == "user_input_required"
    }

    var statusKind: StatusKind {
        switch type {
        case "permission_request", "user_input_required": return .review
        case "error": return .error
        case "task_complete", "session_ended": return .done
        default: return .running // session_started and any unknown/progress type
        }
    }

    var projectName: String? {
        metadata?["projectName"]?.stringValue
    }

    var freeformAllowed: Bool {
        metadata?["freeformAllowed"]?.boolValue
            ?? (actions ?? []).contains { $0.action == "reply" }
    }

    /// Number of additional questions beyond the first in a multi-question prompt.
    /// 0 when there is a single question (or no questions metadata).
    var extraQuestionCount: Int {
        if case .array(let items)? = metadata?["questions"], items.count > 1 {
            return items.count - 1
        }
        return 0
    }

    // MARK: - Vibe-island session detail (all optional; hooks fill them best-effort)

    /// "Editing auth.ts", "Running bun", … — the current tool, from PreToolUse.
    var activity: String? { metadata?["activity"]?.stringValue }

    /// Short model family: "opus" / "sonnet" / "haiku".
    var model: String? { metadata?["model"]?.stringValue }

    /// Rough context-window fill, 0–100. nil when unknown.
    var contextPct: Int? { metadata?["contextPct"]?.intValue }

    /// Todo progress as "3/5", or nil when the session has no todo list.
    var todoLabel: String? {
        guard let total = metadata?["todosTotal"]?.intValue, total > 0 else { return nil }
        let done = metadata?["todosDone"]?.intValue ?? 0
        return "\(done)/\(total)"
    }

    private var startedAt: Date? { ISOTime.parse(metadata?["startedAt"]?.stringValue) }
    private var lastActiveAt: Date? { ISOTime.parse(metadata?["lastActiveAt"]?.stringValue) }

    /// Elapsed since the turn began — live while running, frozen at completion
    /// (createdAt) once done. nil when we never captured a start time.
    var elapsedLabel: String? {
        guard let start = startedAt else { return nil }
        let end = statusKind == .running ? Date() : (ISOTime.parse(createdAt) ?? Date())
        let secs = max(0, Int(end.timeIntervalSince(start)))
        if secs < 60 { return "\(secs)s" }
        if secs < 3600 { return "\(secs / 60)m\(secs % 60)s" }
        return "\(secs / 3600)h\(secs % 3600 / 60)m"
    }

    /// A running session whose last tool fired a while ago — likely stalled on a
    /// long tool or hung. Best-effort hint, generous threshold to avoid crying wolf.
    /// (No statusline heartbeat: it wouldn't tick through a long blocking tool
    /// either, so record-age is the same signal for less machinery.)
    var isStalled: Bool {
        guard statusKind == .running, let last = lastActiveAt else { return false }
        return Date().timeIntervalSince(last) > 120
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
