import app from "./app.js";

const port = Number(process.env.BACKEND_PORT ?? 4000);

app.listen(port, "0.0.0.0", () => {
    console.log(`GateWatch backend listening on port ${port}`);
});