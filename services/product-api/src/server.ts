import express from "express";

const app = express();
const port = Number(process.env.PORT ?? 3002);

app.use(express.json());

app.get("/health", (_req, res) => {
    res.json({
        status: "ok",
        service: "product-api",
    });
});

app.get("/products", (_req, res) => {
    res.json({
        data: [
            {
                id: 1,
                name: "Laptop",
            },
            {
                id: 2,
                name: "Keyboard",
            },
        ],
    });
});

app.listen(port, "0.0.0.0", () => {
    console.log(`Product API listening on port ${port}`);
});