import { Response } from 'express';

export const sendSuccess = (res: Response, data: any, message = 'Success', status = 200, meta?: any) => {
  res.status(status).json({
    success: true,
    message,
    data,
    ...(meta && { meta }),
  });
};

export const sendError = (res: Response, error: any, message = 'Error', status = 500) => {
  res.status(status).json({
    success: false,
    message,
    error: typeof error === 'string' ? error : error.message || 'Internal Server Error',
  });
};
