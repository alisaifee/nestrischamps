const middlewares = require('../modules/middlewares');
const layouts = require('../modules/layouts');
const UserDAO = require('../daos/UserDAO');
const Connection = require('../modules/Connection');

module.exports = function init(server, wss) {
	server.on('upgrade', async function (request, socket, head) {
		console.log('WS: ', request.url);

		const m = request.url.match(/^\/ws\/view\/([a-z0-9_-]+)\/([a-zA-Z0-9-]+)/);

		request.is_secret_view = !!m;

		if (request.is_secret_view) {
			if (!request.tetris) {
				request.tetris = {};
			}

			request.tetris.view = {
				single_player: layouts[m[1]].type == '1p',
				layout_id:     m[1],
				user_secret:   m[2],
			};

			// connection from the non-session-ed views (from OBS)
			const user = await UserDAO.getUserBySecret(request.tetris.view.user_secret);

			console.log(`WS: Retrieved user ${user.login} from view secret`, request.tetris.view);

			if (!request.session) {
				request.session = {};
			}

			request.session.user = {
				id:     user.id,
				login:  user.login,
				secret: user.secret,
			};

			wss.handleUpgrade(request, socket, head, function (ws) {
				wss.emit('connection', ws, request);
			});
		}
		else {
			// all other connections must be within a session!
			// i.e. producers and admin connections

			middlewares.sessionMiddleware(request, {}, () => {
				if (!request.session.user) {
					socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); // TODO: can this redirect?
					socket.destroy();
					return;
				}

				console.log(`WS: Retrieved user ${request.session.user.login} from session`);

				wss.handleUpgrade(request, socket, head, function (ws) {
					console.log('WS: handleUpgrade complete');
					wss.emit('connection', ws, request);
				});
			});
		}
	});

	wss.on('connection', async (ws, request) => {
		console.log('WS: Connection!', request.session.user.id, 'secret?', request.is_secret_view);

		const user = await UserDAO.getUserById(request.session.user.id);
		const connection = new Connection(user, ws);

		let m; // for url matching (if needed below)

		user.addConnection(connection);

		if (request.is_secret_view) {
			console.log('Adding View', user.login, 'single?', request.tetris.view.single_player);
			const room = request.tetris.view.single_player
				? user.getPrivateRoom()
				: user.getMatchRoom()
			;

			room.addView(connection);
		}
		else if(request.url === '/ws/room/admin') {
			console.log(`Room: ${user.login}: Admin connecting`);
			user.getMatchRoom().setAdmin(connection);
		}
		else if(request.url === '/ws/producer') {
			user.getPrivateRoom().setProducer(connection);
		}
		else if(m = request.url.match(/^\/ws\/room\/u\/([a-z0-9_-]+)\//)) {
			const target_user = UserDAO.getUserByLogin(m[1]);

			if (!target_user) {
				// TODO: do at Page or Upgrade level, not at websocket level
				// Although websocket is closest to resolution
				// Page level *could* cause race conditions...
				// Both Page level and Upgrade level could check for target User and throw 404s
				connection.kick('invalid_target');
			}
			else {
				switch(request.url.split('/')[4]) {
					case 'admin': {
						target_user.getMatchRoom().setAdmin(connection);
						break;
					}
					case 'producer': {
						target_user.getMatchRoom().addProducer(connection);
						break;
					}
					default: {
						connection.kick('invalid_url');
					}
				}
			}
		}
		else {
			console.log('Unrecognized connection');
		}
	});
};