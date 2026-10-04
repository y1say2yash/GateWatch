import { Router } from 'express';

import { handleGatewayRequest } from './gateway-controller.js';

const router = Router();

router.all('/p/:projectSlug{/*gatewayPath}', handleGatewayRequest);

export default router;