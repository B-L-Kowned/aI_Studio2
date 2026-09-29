import { Router } from 'express';
import { courses, reorderCourse, setCourse } from '../lib/training.js';
import { requireProgram } from '../lib/require-program.js';
import { ok, fail, route } from '../utils/respond.js';

// Every route here belongs to the `content` program. The gate is on the router,
// not on each handler, so a route added later cannot forget it.
const router = Router();
router.use(requireProgram('content'));

router.get('/courses', route(async (_req, res) => ok(res, courses())));

router.post(
  '/courses/:id/order',
  route(async (req, res) => {
    const ids = req.body?.productionIds;
    if (!Array.isArray(ids) || ids.some((n) => !Number.isInteger(n))) {
      return fail(res, 400, 'BAD_ORDER', 'productionIds must be an array of production ids');
    }
    try {
      const n = reorderCourse(Number(req.params.id), ids);
      return ok(res, courses(), `${n} lesson${n === 1 ? '' : 's'} reordered`);
    } catch (err) {
      return fail(res, err.code === 'NOT_IN_COURSE' ? 400 : 500, err.code ?? 'ERROR', err.message);
    }
  })
);

router.post(
  '/lessons/:id/course',
  route(async (req, res) => {
    const courseId = req.body?.courseId ?? null;
    try {
      setCourse(Number(req.params.id), courseId === null ? null : Number(courseId));
      return ok(res, courses(), courseId ? 'Added to the course' : 'Removed from the course');
    } catch (err) {
      return fail(res, err.code === 'NOT_FOUND' ? 404 : 500, err.code ?? 'ERROR', err.message);
    }
  })
);

export default router;
