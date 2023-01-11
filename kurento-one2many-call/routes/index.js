const routes = require('express').Router();

routes.get('/example', async (req, res) => {
  res.render('example')
});

routes.get('/', async (req, res) => {
  res.render('app', {
    content: 'pages/room'
  });
});

module.exports = routes;