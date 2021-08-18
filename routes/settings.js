const express = require('express');
const router = express.Router();
const ULID = require('ulid');
const nocache = require('nocache');

const middlewares = require('../modules/middlewares');
const countries = require('../modules/countries');
const UserDAO = require('../daos/UserDAO');

router.use(middlewares.assertSession);
router.use(middlewares.checkToken);
router.use(nocache());

router.get('/', async (req, res) => {
	const user = await UserDAO.getUserById(req.session.user.id);

	if (!user) {
		res.status(404).send('User Not found');
		return;
	}

	res.render('settings', {
		db_user: user,
		countries,
	});
});

router.get('/revoke_secret', async (req, res) => {
	const user = await UserDAO.getUserById(req.session.user.id);

	if (!user) {
		res.status(404).send('User Not found');
		return;
	}

	await UserDAO.updateSecret(user, ULID.ulid());

	req.session.user = {
		id: user.id,
		login: user.login,
		secret: user.secret,
		profile_image_url: user.profile_i1mage_url,
	};

	res.redirect('/settings');
});

router.get('/clear_session', async (req, res) => {
	req.session.destroy();
	res.redirect('/');
});

router.post('/update_profile', express.json(), async (req, res) => {
	if (!req.body) {
		res.status(400).json({ errors: ['Bad Request'] });
		return;
	}

	const errors = [];
	const update = {};

	if (/^(das|tap|roll|hybrid)$/i.test(req.body.style)) {
		update.style = req.body.style.toLowerCase();
	} else {
		errors.push('Style is not valid');
	}

	const code = (req.body.country_code || '').toUpperCase();

	if (code && countries.some(country => country.code === code)) {
		update.country_code = code;
	} else {
		errors.push('Country code is not valid');
	}

	if (typeof req.body.interests === 'string') {
		update.interests = req.body.interests;
	} else {
		errors.push('Interests are not valid');
	}

	if (errors.length) {
		res.status(400).json({ errors });
	} else {
		await UserDAO.updateProfile(req.session.user.id, update);
		res.status(200).json({});
	}
});

router.post('/update_pb', async (req, res) => {});

module.exports = router;
