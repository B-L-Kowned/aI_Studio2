export function ok(res, data, message = 'Success') {
  return res.json({ data, error: null, message });
}

export function fail(res, status, error, message) {
  return res.status(status).json({ data: null, error, message });
}

// Wraps an async route so a rejected promise reaches the error middleware
// instead of hanging the request.
export function route(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}
