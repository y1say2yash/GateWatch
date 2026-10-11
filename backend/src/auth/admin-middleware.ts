import type { NextFunction, Request, Response } from 'express';

export function requireAdmin(
    _request: Request,
    response: Response,
    next: NextFunction,
): void {
    if (!response.locals.user?.isAdmin) {
        response.status(403).json({
            error: {
                code: 'ADMIN_ACCESS_REQUIRED',
                message: 'Administrator access is required.',
            },
        });
        return;
    }

    next();
}
