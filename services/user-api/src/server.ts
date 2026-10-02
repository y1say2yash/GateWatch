import express from "express";

const app = express();
const port = Number(process.env.PORT ?? 3003);

app.use(express.json());

app.get("/health", (_req, res) => {
    res.json({
        status: "ok",
        service: "user-api",
    });
});

app.get("/users", (_req, res) => {
    res.json({
        data: [
            {
                id: 1,
                name: "Demo User",
            },
            {
                id: 2,
                name: "Test User",
            },
        ],
    });
});

app.listen(port, "0.0.0.0", () => {
    console.log(`User API listening on port ${port}`);
});