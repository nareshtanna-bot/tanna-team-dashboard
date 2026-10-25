import { createInboxHandler } from '../../lib/inbox-handler.js';

// GET and PATCH /api/inbox/:id (Vercel passes the id as req.query.id)
export default createInboxHandler();
