import express from "express";

type Product = {
    id: number;
    name: string;
    category: string;
    price: number;
    stock: number;
};

const app = express();
const port = Number(process.env.PORT ?? 3002);

const products: Product[] = [
    { id: 1, name: "Laptop", category: "Electronics", price: 999, stock: 12 },
    { id: 2, name: "Keyboard", category: "Accessories", price: 79, stock: 35 },
    { id: 3, name: "Smartphone", category: "Electronics", price: 699, stock: 20 },
];

app.use(express.json());

app.get("/health", (_req, res) => {
    res.json({
        status: "ok",
        service: "product-api",
    });
});

app.get("/categories", (_req, res) => {
    res.json({
        data: [...new Set(products.map((product) => product.category))],
    });
});

app.get("/products/search", (req, res) => {
    const query = req.query.q;

    if (typeof query !== "string" || query.trim().length === 0) {
        res.status(400).json({ error: "A non-empty search query is required" });
        return;
    }

    const normalizedQuery = query.trim().toLowerCase();
    const matches = products.filter(
        (product) =>
            product.name.toLowerCase().includes(normalizedQuery) ||
            product.category.toLowerCase().includes(normalizedQuery),
    );

    res.json({ data: matches });
});

app.get("/products", (_req, res) => {
    res.json({ data: products });
});

app.get("/products/:id", (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id < 1) {
        res.status(400).json({ error: "Product ID must be a positive integer" });
        return;
    }

    const product = products.find((item) => item.id === id);

    if (!product) {
        res.status(404).json({ error: "Product not found" });
        return;
    }

    res.json({ data: product });
});

app.get("/products/:id/stock", (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id < 1) {
        res.status(400).json({ error: "Product ID must be a positive integer" });
        return;
    }

    const product = products.find((item) => item.id === id);

    if (!product) {
        res.status(404).json({ error: "Product not found" });
        return;
    }

    res.json({
        data: {
            productId: product.id,
            stock: product.stock,
        },
    });
});

app.listen(port, "0.0.0.0", () => {
    console.log(`Product API listening on port ${port}`);
});
