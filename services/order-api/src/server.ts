import express from "express";

const app = express();
const port = Number(process.env.PORT ?? 3001);

app.use(express.json());

app.get("/health", (_req, res) => {
    res.json({
        status: "ok",
        service: "order-api",
    });
});

app.get("/orders", (_req, res) => {
    res.json({
        data: [
            {
                id: 1,
                status: "pending",
            },
            {
                id: 2,
                status: "completed",
            },
        ],
    });
});

app.listen(port, "0.0.0.0", () => {
    console.log(`Order API listening on port ${port}`);
});