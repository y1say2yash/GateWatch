import express from "express";

type OrderItem = {
    productId: number;
    quantity: number;
};

type Order = {
    id: number;
    userId: number;
    status: string;
    items: OrderItem[];
};

const app = express();
const port = Number(process.env.PORT ?? 3001);
const allowedStatuses = ["pending", "processing", "shipped", "completed", "cancelled"];

const orders: Order[] = [
    {
        id: 1,
        userId: 1,
        status: "pending",
        items: [
            { productId: 1, quantity: 1 },
            { productId: 2, quantity: 1 },
        ],
    },
    {
        id: 2,
        userId: 2,
        status: "completed",
        items: [{ productId: 3, quantity: 1 }],
    },
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

app.use(express.json());

app.get("/health", (_req, res) => {
    res.json({
        status: "ok",
        service: "order-api",
    });
});

app.get("/orders", (_req, res) => {
    res.json({ data: orders });
});

app.get("/orders/:id/items", (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id < 1) {
        res.status(400).json({ error: "Order ID must be a positive integer" });
        return;
    }

    const order = orders.find((item) => item.id === id);

    if (!order) {
        res.status(404).json({ error: "Order not found" });
        return;
    }

    res.json({ data: order.items });
});

app.get("/orders/:id", (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id < 1) {
        res.status(400).json({ error: "Order ID must be a positive integer" });
        return;
    }

    const order = orders.find((item) => item.id === id);

    if (!order) {
        res.status(404).json({ error: "Order not found" });
        return;
    }

    res.json({ data: order });
});

app.post("/orders", (req, res) => {
    const body: unknown = req.body;

    if (!isRecord(body)) {
        res.status(400).json({ error: "A valid userId and items array are required" });
        return;
    }

    const userId = body.userId;
    const itemsInput = body.items;
    const validItems =
        Array.isArray(itemsInput) &&
        itemsInput.length > 0 &&
        itemsInput.every(
            (item) =>
                isRecord(item) &&
                Number.isInteger(item.productId) &&
                Number(item.productId) > 0 &&
                Number.isInteger(item.quantity) &&
                Number(item.quantity) > 0,
        );

    if (
        !Number.isInteger(userId) ||
        Number(userId) < 1 ||
        !validItems ||
        !Array.isArray(itemsInput)
    ) {
        res.status(400).json({
            error: "userId must be a positive integer and items must contain positive productId and quantity values",
        });
        return;
    }

    const items: OrderItem[] = itemsInput.map((item) => {
        const orderItem = item as Record<string, unknown>;
        return {
            productId: Number(orderItem.productId),
            quantity: Number(orderItem.quantity),
        };
    });
    const order: Order = {
        id: Math.max(0, ...orders.map((item) => item.id)) + 1,
        userId: Number(userId),
        status: "pending",
        items,
    };

    orders.push(order);
    res.status(201).json({ data: order });
});

app.patch("/orders/:id/status", (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id < 1) {
        res.status(400).json({ error: "Order ID must be a positive integer" });
        return;
    }

    const body: unknown = req.body;

    if (!isRecord(body) || typeof body.status !== "string" || !allowedStatuses.includes(body.status)) {
        res.status(400).json({
            error: `status must be one of: ${allowedStatuses.join(", ")}`,
        });
        return;
    }

    const order = orders.find((item) => item.id === id);

    if (!order) {
        res.status(404).json({ error: "Order not found" });
        return;
    }

    order.status = body.status;
    res.json({ data: order });
});

app.listen(port, "0.0.0.0", () => {
    console.log(`Order API listening on port ${port}`);
});
