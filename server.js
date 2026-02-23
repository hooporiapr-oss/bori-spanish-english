const express = require('express');
const path = require('path');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 3000;

// Security headers (relaxed for inline styles/scripts)
app.use(helmet({ contentSecurityPolicy: false }));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Catch-all → index
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`[Hey Bori] Language landing live on port ${PORT}`);
});
