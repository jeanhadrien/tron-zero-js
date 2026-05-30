import app from './main';

const PORT = parseInt(process.env.MANAGER_PORT || '3001', 10);

app.listen(PORT, () => {
  console.log(`[manager] Listening on port ${PORT}`);
});
