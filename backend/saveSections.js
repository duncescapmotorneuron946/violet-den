const express = require('express');
const fs = require('fs');
const dotenv = require('dotenv');
const cors = require('cors');
const { Client } = require('ssh2');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/save-sections', (req, res) => {
  const { config } = req.body;
  const envPath = process.env.ENV_PATH || '../.env';
  let env = fs.readFileSync(envPath, 'utf8');
  env = env.replace(/REACT_APP_SECTIONS=.*\n?/, '');
  env += `REACT_APP_SECTIONS=${config}\n`;
  fs.writeFileSync(envPath, env);
  res.json({ success: true });
});

// ...existing backend code...

module.exports = app;
