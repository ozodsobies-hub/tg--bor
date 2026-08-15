const jwt = require('jsonwebtoken');
const { getSetting } = require('../db');

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token yo\'q' });

  try {
    const secret = getSetting('jwt_secret');
    const payload = jwt.verify(token, secret);
    req.admin = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token yaroqsiz yoki muddati o\'tgan' });
  }
}

module.exports = authMiddleware;
