import express from "express";

type User = {
    id: number;
    name: string;
    email: string;
};

type DemoOrder = {
    id: number;
    status: string;
    items: { productId: number; quantity: number }[];
};

const app = express();
const port = Number(process.env.PORT ?? 3003);

const users: User[] = [
    { id: 1, name: "Demo User", email: "demo@example.com" },
    { id: 2, name: "Test User", email: "test@example.com" },
];

// This fixed relationship keeps the demo independent of the order-api service.
const demoOrdersByUserId: Record<number, DemoOrder[]> = {
    1: [
        {
            id: 1,
            status: "pending",
            items: [
                { productId: 1, quantity: 1 },
                { productId: 2, quantity: 1 },
            ],
        },
    ],
    2: [
        {
            id: 2,
            status: "completed",
            items: [{ productId: 3, quantity: 1 }],
        },
    ],
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
const isNonEmptyString = (value: unknown): value is string =>
    typeof value === "string" && value.trim().length > 0;
const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

app.use(express.json());

app.get("/health", (_req, res) => {
    res.json({
        status: "ok",
        service: "user-api",
    });
});

app.get("/users", (_req, res) => {
    res.json({ data: users });
});

app.get("/users/:id/orders", (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id < 1) {
        res.status(400).json({ error: "User ID must be a positive integer" });
        return;
    }

    const user = users.find((item) => item.id === id);

    if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
    }

    res.json({ data: demoOrdersByUserId[id] ?? [] });
});

app.get("/users/:id", (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id < 1) {
        res.status(400).json({ error: "User ID must be a positive integer" });
        return;
    }

    const user = users.find((item) => item.id === id);

    if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
    }

    res.json({ data: user });
});

app.post("/users", (req, res) => {
    const body: unknown = req.body;

    if (
        !isRecord(body) ||
        !isNonEmptyString(body.name) ||
        !isNonEmptyString(body.email) ||
        !isValidEmail(body.email)
    ) {
        res.status(400).json({ error: "A non-empty name and valid email are required" });
        return;
    }

    const user: User = {
        id: Math.max(0, ...users.map((item) => item.id)) + 1,
        name: body.name.trim(),
        email: body.email.trim(),
    };

    users.push(user);
    res.status(201).json({ data: user });
});

app.patch("/users/:id", (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id < 1) {
        res.status(400).json({ error: "User ID must be a positive integer" });
        return;
    }

    const body: unknown = req.body;

    if (
        !isRecord(body) ||
        Object.keys(body).length === 0 ||
        Object.keys(body).some((field) => field !== "name" && field !== "email") ||
        (Object.hasOwn(body, "name") && !isNonEmptyString(body.name)) ||
        (Object.hasOwn(body, "email") &&
            (!isNonEmptyString(body.email) || !isValidEmail(body.email)))
    ) {
        res.status(400).json({ error: "Provide a non-empty name and/or valid email only" });
        return;
    }

    const user = users.find((item) => item.id === id);

    if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
    }

    if (Object.hasOwn(body, "name")) {
        user.name = (body.name as string).trim();
    }

    if (Object.hasOwn(body, "email")) {
        user.email = (body.email as string).trim();
    }

    res.json({ data: user });
});

app.listen(port, "0.0.0.0", () => {
    console.log(`User API listening on port ${port}`);
});
