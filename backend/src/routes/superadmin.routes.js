const router = require('express').Router();
const ctrl = require('../controllers/superadmin.controller');
const auth = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { validate, createCompanySchema, updateCompanySchema, createFactorySchema, createUserSchema } = require('../utils/validators');

// All routes require superadmin
router.use(auth, requireRole('superadmin'));

// Companies
router.get('/companies', ctrl.listCompanies);
router.post('/companies', validate(createCompanySchema), ctrl.createCompany);
router.put('/companies/:id', validate(updateCompanySchema), ctrl.updateCompany);
router.delete('/companies/:id', ctrl.deactivateCompany);

// Factories
router.get('/factories', ctrl.listAllFactories);
router.post('/companies/:companyId/factories', validate(createFactorySchema), ctrl.createFactory);
router.put('/factories/:id', ctrl.updateFactory);

// Manager creation
router.post('/companies/:companyId/manager', validate(createUserSchema), ctrl.createManager);

// Stats
router.get('/stats', ctrl.getStats);

module.exports = router;
