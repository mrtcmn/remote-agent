import { Elysia, t } from 'elysia';
import { nanoid } from 'nanoid';
import { eq, and, isNull } from 'drizzle-orm';
import { db, reviewComments, claudeSessions } from '../db';
import { requireAuth } from '../auth/middleware';

// Helper function to format comments for Claude message
function formatClaudeMessage(comments: typeof reviewComments.$inferSelect[]): string {
	if (comments.length === 0) {
		return '';
	}

	const batchId = comments[0]?.batchId || '';

	// Group comments by file path
	const byFile = new Map<string, typeof reviewComments.$inferSelect[]>();
	for (const comment of comments) {
		const existing = byFile.get(comment.filePath) || [];
		existing.push(comment);
		byFile.set(comment.filePath, existing);
	}

	let message = 'Please make the following code review changes:\n\n';

	for (const [filePath, fileComments] of byFile) {
		message += `## ${filePath}\n\n`;

		for (const comment of fileComments) {
			const sideLabel = comment.lineSide === 'additions' ? 'addition' : 'deletion';
			message += `**Line ${comment.lineNumber} (${sideLabel}):**\n`;
			message += '```\n';
			message += `${comment.lineContent}\n`;
			message += '```\n';
			message += `> ${comment.comment}\n\n`;
		}
	}

	message += '---\n';
	message += `Batch ID: ${batchId}`;

	return message;
}

export const reviewCommentsRoutes = new Elysia({ prefix: '/sessions/:sessionId/review-comments' })
	.use(requireAuth)

	// List comments (with optional filtering)
	.get('/', async ({ user, params, query, set }) => {
		const session = await db.query.claudeSessions.findFirst({
			where: and(
				eq(claudeSessions.id, params.sessionId),
				eq(claudeSessions.userId, user!.id)
			),
		});

		if (!session) {
			set.status = 404;
			return { error: 'Session not found' };
		}

		let whereConditions = [eq(reviewComments.sessionId, params.sessionId)];

		if (query.status) {
			whereConditions.push(eq(reviewComments.status, query.status as 'pending' | 'running' | 'resolved'));
		}

		if (query.batchId) {
			whereConditions.push(eq(reviewComments.batchId, query.batchId));
		}

		const comments = await db.query.reviewComments.findMany({
			where: and(...whereConditions),
			orderBy: (c, { asc }) => [asc(c.createdAt)],
		});

		return comments;
	}, {
		params: t.Object({
			sessionId: t.String(),
		}),
		query: t.Object({
			status: t.Optional(t.Union([
				t.Literal('pending'),
				t.Literal('running'),
				t.Literal('resolved'),
			])),
			batchId: t.Optional(t.String()),
		}),
	})

	// Create comment
	.post('/', async ({ user, params, body, set }) => {
		const session = await db.query.claudeSessions.findFirst({
			where: and(
				eq(claudeSessions.id, params.sessionId),
				eq(claudeSessions.userId, user!.id)
			),
		});

		if (!session) {
			set.status = 404;
			return { error: 'Session not found' };
		}

		const commentId = nanoid();

		await db.insert(reviewComments).values({
			id: commentId,
			sessionId: params.sessionId,
			batchId: null,
			filePath: body.filePath,
			lineNumber: body.lineNumber,
			lineSide: body.lineSide,
			lineContent: body.lineContent,
			fileSha: body.fileSha || null,
			comment: body.comment,
			status: 'pending',
			createdAt: new Date(),
			resolvedAt: null,
		});

		const comment = await db.query.reviewComments.findFirst({
			where: eq(reviewComments.id, commentId),
		});

		return comment;
	}, {
		params: t.Object({
			sessionId: t.String(),
		}),
		body: t.Object({
			filePath: t.String(),
			lineNumber: t.Number(),
			lineSide: t.Union([t.Literal('additions'), t.Literal('deletions')]),
			lineContent: t.String(),
			fileSha: t.Optional(t.String()),
			comment: t.String(),
		}),
	})

	// Update comment text (only pending comments)
	.patch('/:id', async ({ user, params, body, set }) => {
		const session = await db.query.claudeSessions.findFirst({
			where: and(
				eq(claudeSessions.id, params.sessionId),
				eq(claudeSessions.userId, user!.id)
			),
		});

		if (!session) {
			set.status = 404;
			return { error: 'Session not found' };
		}

		const comment = await db.query.reviewComments.findFirst({
			where: and(
				eq(reviewComments.id, params.id),
				eq(reviewComments.sessionId, params.sessionId)
			),
		});

		if (!comment) {
			set.status = 404;
			return { error: 'Comment not found' };
		}

		if (comment.status !== 'pending') {
			set.status = 400;
			return { error: 'Can only update pending comments' };
		}

		await db.update(reviewComments)
			.set({ comment: body.comment })
			.where(eq(reviewComments.id, params.id));

		const updated = await db.query.reviewComments.findFirst({
			where: eq(reviewComments.id, params.id),
		});

		return updated;
	}, {
		params: t.Object({
			sessionId: t.String(),
			id: t.String(),
		}),
		body: t.Object({
			comment: t.String(),
		}),
	})

	// Delete comment (only pending comments)
	.delete('/:id', async ({ user, params, set }) => {
		const session = await db.query.claudeSessions.findFirst({
			where: and(
				eq(claudeSessions.id, params.sessionId),
				eq(claudeSessions.userId, user!.id)
			),
		});

		if (!session) {
			set.status = 404;
			return { error: 'Session not found' };
		}

		const comment = await db.query.reviewComments.findFirst({
			where: and(
				eq(reviewComments.id, params.id),
				eq(reviewComments.sessionId, params.sessionId)
			),
		});

		if (!comment) {
			set.status = 404;
			return { error: 'Comment not found' };
		}

		if (comment.status !== 'pending') {
			set.status = 400;
			return { error: 'Can only delete pending comments' };
		}

		await db.delete(reviewComments)
			.where(eq(reviewComments.id, params.id));

		return { success: true };
	}, {
		params: t.Object({
			sessionId: t.String(),
			id: t.String(),
		}),
	})

	// Create batch from pending comments
	.post('/proceed', async ({ user, params, set }) => {
		const session = await db.query.claudeSessions.findFirst({
			where: and(
				eq(claudeSessions.id, params.sessionId),
				eq(claudeSessions.userId, user!.id)
			),
		});

		if (!session) {
			set.status = 404;
			return { error: 'Session not found' };
		}

		// Get all pending comments without a batch ID
		const pendingComments = await db.query.reviewComments.findMany({
			where: and(
				eq(reviewComments.sessionId, params.sessionId),
				eq(reviewComments.status, 'pending'),
				isNull(reviewComments.batchId)
			),
			orderBy: (c, { asc }) => [asc(c.filePath), asc(c.lineNumber)],
		});

		if (pendingComments.length === 0) {
			set.status = 400;
			return { error: 'No pending comments to process' };
		}

		// Generate batch ID
		const batchId = nanoid();

		// Update all pending comments with the batch ID and set status to running
		await db.update(reviewComments)
			.set({ batchId, status: 'running' })
			.where(
				and(
					eq(reviewComments.sessionId, params.sessionId),
					eq(reviewComments.status, 'pending'),
					isNull(reviewComments.batchId)
				)
			);

		// Fetch updated comments
		const batchComments = await db.query.reviewComments.findMany({
			where: eq(reviewComments.batchId, batchId),
			orderBy: (c, { asc }) => [asc(c.filePath), asc(c.lineNumber)],
		});

		const message = formatClaudeMessage(batchComments);

		return {
			batchId,
			commentCount: batchComments.length,
			message,
		};
	}, {
		params: t.Object({
			sessionId: t.String(),
		}),
	})

	// List all batches with counts
	.get('/batches', async ({ user, params, set }) => {
		const session = await db.query.claudeSessions.findFirst({
			where: and(
				eq(claudeSessions.id, params.sessionId),
				eq(claudeSessions.userId, user!.id)
			),
		});

		if (!session) {
			set.status = 404;
			return { error: 'Session not found' };
		}

		// Get all comments for this session
		const allComments = await db.query.reviewComments.findMany({
			where: eq(reviewComments.sessionId, params.sessionId),
			orderBy: (c, { desc }) => [desc(c.createdAt)],
		});

		// Group by batch ID
		const batches = new Map<string, {
			batchId: string;
			status: 'pending' | 'running' | 'resolved';
			commentCount: number;
			createdAt: Date;
			resolvedAt: Date | null;
		}>();

		for (const comment of allComments) {
			if (!comment.batchId) {
				continue;
			}

			const existing = batches.get(comment.batchId);
			if (existing) {
				existing.commentCount++;
			} else {
				batches.set(comment.batchId, {
					batchId: comment.batchId,
					status: comment.status,
					commentCount: 1,
					createdAt: comment.createdAt,
					resolvedAt: comment.resolvedAt,
				});
			}
		}

		return Array.from(batches.values()).sort((a, b) =>
			b.createdAt.getTime() - a.createdAt.getTime()
		);
	}, {
		params: t.Object({
			sessionId: t.String(),
		}),
	})

	// Resolve batch
	.post('/batches/:batchId/resolve', async ({ user, params, set }) => {
		const session = await db.query.claudeSessions.findFirst({
			where: and(
				eq(claudeSessions.id, params.sessionId),
				eq(claudeSessions.userId, user!.id)
			),
		});

		if (!session) {
			set.status = 404;
			return { error: 'Session not found' };
		}

		// Check if batch exists
		const batchComments = await db.query.reviewComments.findMany({
			where: and(
				eq(reviewComments.sessionId, params.sessionId),
				eq(reviewComments.batchId, params.batchId)
			),
		});

		if (batchComments.length === 0) {
			set.status = 404;
			return { error: 'Batch not found' };
		}

		// Mark all comments in batch as resolved
		await db.update(reviewComments)
			.set({ status: 'resolved', resolvedAt: new Date() })
			.where(
				and(
					eq(reviewComments.sessionId, params.sessionId),
					eq(reviewComments.batchId, params.batchId)
				)
			);

		return { success: true };
	}, {
		params: t.Object({
			sessionId: t.String(),
			batchId: t.String(),
		}),
	})

	// Rerun batch (clone as new pending comments)
	.post('/batches/:batchId/rerun', async ({ user, params, set }) => {
		const session = await db.query.claudeSessions.findFirst({
			where: and(
				eq(claudeSessions.id, params.sessionId),
				eq(claudeSessions.userId, user!.id)
			),
		});

		if (!session) {
			set.status = 404;
			return { error: 'Session not found' };
		}

		// Get all comments from the batch
		const batchComments = await db.query.reviewComments.findMany({
			where: and(
				eq(reviewComments.sessionId, params.sessionId),
				eq(reviewComments.batchId, params.batchId)
			),
		});

		if (batchComments.length === 0) {
			set.status = 404;
			return { error: 'Batch not found' };
		}

		// Create new pending comments with same content
		const newComments = batchComments.map(comment => ({
			id: nanoid(),
			sessionId: params.sessionId,
			batchId: null,
			filePath: comment.filePath,
			lineNumber: comment.lineNumber,
			lineSide: comment.lineSide,
			lineContent: comment.lineContent,
			fileSha: comment.fileSha,
			comment: comment.comment,
			status: 'pending' as const,
			createdAt: new Date(),
			resolvedAt: null,
		}));

		await db.insert(reviewComments).values(newComments);

		return {
			success: true,
			clonedCount: newComments.length,
		};
	}, {
		params: t.Object({
			sessionId: t.String(),
			batchId: t.String(),
		}),
	});
