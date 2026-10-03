import { Router } from 'express';

import { requireAuthentication } from '../auth/session-middleware.js';
import {
    createProject,
    deleteProject,
    getProject,
    listProjects,
    updateProject,
} from './project-controller.js';

const router = Router();

router.use(requireAuthentication);

router.get('/', listProjects);
router.post('/', createProject);
router.get('/:id', getProject);
router.patch('/:id', updateProject);
router.delete('/:id', deleteProject);

export default router;