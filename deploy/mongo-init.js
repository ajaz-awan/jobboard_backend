const appUser = process.env.MONGO_APP_USER;
const appPassword = process.env.MONGO_APP_PASSWORD;
if (!appUser || !appPassword) throw new Error('Application database credentials are required');
db.getSiblingDB('jobboard').createUser({ user: appUser, pwd: appPassword, roles: [{ role: 'readWrite', db: 'jobboard' }] });
