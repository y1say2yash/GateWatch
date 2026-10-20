import database from '../src/config/database.js';
import { runUserHealthCheck } from '../src/health/health-service.js';
import { executeUserTest } from '../src/tests/test-service.js';
import { validateCreateApiInput } from '../src/apis/api-validation.js';
import { validateTestInput } from '../src/tests/test-validation.js';
import type { TestAssertion, TestInput } from '../src/tests/test-types.js';

const SEED_MARKER = 'gatewatch:demo-seed:v1';
const LEGACY_PROJECT_NAME = 'GateWatch Demo Seed';
const LEGACY_PROJECT_DESCRIPTION =
    `GateWatch demo project (seed marker: ${SEED_MARKER}).`;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUIRED_TABLES = [
    'users',
    'projects',
    'apis',
    'api_routes',
    'rate_limit_configs',
    'health_check_configs',
    'tests',
    'test_executions',
    'health_checks',
    'alerts',
    'request_history',
];

class DemoSeedError extends Error { }

interface RouteDefinition {
    pathPrefix: string;
    method: 'GET' | 'POST' | 'PATCH';
}

interface TestDefinition {
    name: string;
    path: string;
    assertions: TestAssertion[];
}

interface ProjectDefinition {
    key: string;
    name: string;
}

interface ApiDefinition {
    key: string;
    projectKey: string;
    name: string;
    description: string;
    urlEnvironmentVariable: string;
    defaultHostname: string;
    defaultPort: string;
    upstreamBasePath: string;
    routes: RouteDefinition[];
    tests: TestDefinition[];
    alerts: Array<{
        name: string;
        type: 'API_DOWN' | 'ERROR_RATE';
        configuration: Record<string, number>;
    }>;
}

interface SeededApi {
    id: string;
    name: string;
    status: string;
    upstreamUrl: string;
    projectSlug: string;
}

interface SeededTest {
    id: string;
    name: string;
    apiId: string;
    apiName: string;
    apiStatus: string;
    canonical: boolean;
}

interface DemoSeedResult {
    projectSlugs: Record<string, string>;
    createdProjects: number;
    apis: SeededApi[];
    tests: SeededTest[];
    createdApis: number;
    createdRoutes: number;
    createdTests: number;
    createdAlerts: number;
    preservedConfigurations: string[];
}

const projectDefinitions: ProjectDefinition[] = [
    { key: 'product-management', name: 'Product Management' },
    { key: 'order-management', name: 'Order Management' },
    { key: 'user-management', name: 'User Management' },
];

const definitions: ApiDefinition[] = [
    {
        key: 'product-catalog',
        projectKey: 'product-management',
        name: 'Product API',
        description: `GateWatch demo seed ${SEED_MARKER}: product catalog.`,
        urlEnvironmentVariable: 'DEMO_PRODUCT_API_URL',
        defaultHostname: 'product-api',
        defaultPort: process.env.PRODUCT_API_PORT ?? '3002',
        upstreamBasePath: '/products',
        routes: [{ pathPrefix: '/products', method: 'GET' }],
        tests: [
            {
                name: 'Demo: Product API health',
                path: '/health',
                assertions: [
                    { type: 'STATUS_CODE', operator: 'EQUALS', expected: 200 },
                    {
                        type: 'JSON_BODY',
                        path: '/service',
                        operator: 'EQUALS',
                        expected: 'product-api',
                    },
                ],
            },
            {
                name: 'Demo: List products',
                path: '/products',
                assertions: [
                    { type: 'STATUS_CODE', operator: 'EQUALS', expected: 200 },
                    {
                        type: 'JSON_BODY',
                        path: '/data/0/name',
                        operator: 'EQUALS',
                        expected: 'Laptop',
                    },
                ],
            },
            {
                name: 'Demo: Search products',
                path: '/products/search?q=phone',
                assertions: [
                    { type: 'STATUS_CODE', operator: 'EQUALS', expected: 200 },
                    {
                        type: 'JSON_BODY',
                        path: '/data/0/name',
                        operator: 'EQUALS',
                        expected: 'Smartphone',
                    },
                ],
            },
            {
                name: 'Demo: Retrieve product',
                path: '/products/1',
                assertions: [
                    { type: 'STATUS_CODE', operator: 'EQUALS', expected: 200 },
                    {
                        type: 'JSON_BODY',
                        path: '/data/name',
                        operator: 'EQUALS',
                        expected: 'Laptop',
                    },
                ],
            },
            {
                name: 'Demo: Retrieve product stock',
                path: '/products/1/stock',
                assertions: [
                    { type: 'STATUS_CODE', operator: 'EQUALS', expected: 200 },
                    {
                        type: 'JSON_BODY',
                        path: '/data/stock',
                        operator: 'EQUALS',
                        expected: 12,
                    },
                ],
            },
        ],
        alerts: [
            { name: 'Demo: Product API unavailable', type: 'API_DOWN', configuration: {} },
        ],
    },
    {
        key: 'product-categories',
        projectKey: 'product-management',
        name: 'Product Categories',
        description: `GateWatch demo seed ${SEED_MARKER}: product categories.`,
        urlEnvironmentVariable: 'DEMO_PRODUCT_API_URL',
        defaultHostname: 'product-api',
        defaultPort: process.env.PRODUCT_API_PORT ?? '3002',
        upstreamBasePath: '/categories',
        routes: [{ pathPrefix: '/categories', method: 'GET' }],
        tests: [
            {
                name: 'Demo: List product categories',
                path: '/categories',
                assertions: [
                    { type: 'STATUS_CODE', operator: 'EQUALS', expected: 200 },
                    {
                        type: 'JSON_BODY',
                        path: '/data/0',
                        operator: 'EQUALS',
                        expected: 'Electronics',
                    },
                ],
            },
        ],
        alerts: [
            { name: 'Demo: Categories API unavailable', type: 'API_DOWN', configuration: {} },
        ],
    },
    {
        key: 'orders',
        projectKey: 'order-management',
        name: 'Order API',
        description: `GateWatch demo seed ${SEED_MARKER}: orders.`,
        urlEnvironmentVariable: 'DEMO_ORDER_API_URL',
        defaultHostname: 'order-api',
        defaultPort: process.env.ORDER_API_PORT ?? '3001',
        upstreamBasePath: '/orders',
        routes: [
            { pathPrefix: '/orders', method: 'GET' },
            { pathPrefix: '/orders', method: 'POST' },
            { pathPrefix: '/orders', method: 'PATCH' },
        ],
        tests: [
            {
                name: 'Demo: Order API health',
                path: '/health',
                assertions: [
                    { type: 'STATUS_CODE', operator: 'EQUALS', expected: 200 },
                    {
                        type: 'JSON_BODY',
                        path: '/service',
                        operator: 'EQUALS',
                        expected: 'order-api',
                    },
                ],
            },
            {
                name: 'Demo: List orders',
                path: '/orders',
                assertions: [
                    { type: 'STATUS_CODE', operator: 'EQUALS', expected: 200 },
                    {
                        type: 'JSON_BODY',
                        path: '/data/0/status',
                        operator: 'EQUALS',
                        expected: 'pending',
                    },
                ],
            },
            {
                name: 'Demo: Retrieve order items',
                path: '/orders/1/items',
                assertions: [
                    { type: 'STATUS_CODE', operator: 'EQUALS', expected: 200 },
                    {
                        type: 'JSON_BODY',
                        path: '/data/0/productId',
                        operator: 'EQUALS',
                        expected: 1,
                    },
                ],
            },
            {
                name: 'Demo: Missing order returns not found',
                path: '/orders/999',
                assertions: [
                    { type: 'STATUS_CODE', operator: 'EQUALS', expected: 404 },
                ],
            },
        ],
        alerts: [
            { name: 'Demo: Order API unavailable', type: 'API_DOWN', configuration: {} },
            {
                name: 'Demo: Order API error rate',
                type: 'ERROR_RATE',
                configuration: { threshold: 0.5, windowSeconds: 300 },
            },
        ],
    },
    {
        key: 'users',
        projectKey: 'user-management',
        name: 'User API',
        description: `GateWatch demo seed ${SEED_MARKER}: users.`,
        urlEnvironmentVariable: 'DEMO_USER_API_URL',
        defaultHostname: 'user-api',
        defaultPort: process.env.USER_API_PORT ?? '3003',
        upstreamBasePath: '/users',
        routes: [
            { pathPrefix: '/users', method: 'GET' },
            { pathPrefix: '/users', method: 'POST' },
            { pathPrefix: '/users', method: 'PATCH' },
        ],
        tests: [
            {
                name: 'Demo: User API health',
                path: '/health',
                assertions: [
                    { type: 'STATUS_CODE', operator: 'EQUALS', expected: 200 },
                    {
                        type: 'JSON_BODY',
                        path: '/service',
                        operator: 'EQUALS',
                        expected: 'user-api',
                    },
                ],
            },
            {
                name: 'Demo: List users',
                path: '/users',
                assertions: [
                    { type: 'STATUS_CODE', operator: 'EQUALS', expected: 200 },
                    {
                        type: 'JSON_BODY',
                        path: '/data/0/name',
                        operator: 'EQUALS',
                        expected: 'Demo User',
                    },
                ],
            },
            {
                name: 'Demo: Retrieve user orders',
                path: '/users/1/orders',
                assertions: [
                    { type: 'STATUS_CODE', operator: 'EQUALS', expected: 200 },
                    {
                        type: 'JSON_BODY',
                        path: '/data/0/status',
                        operator: 'EQUALS',
                        expected: 'pending',
                    },
                ],
            },
        ],
        alerts: [
            { name: 'Demo: User API unavailable', type: 'API_DOWN', configuration: {} },
        ],
    },
];

function getUserIdArgument(args: string[]): string | null {
    if (
        args.length !== 2 ||
        args[0] !== '--user-id' ||
        !UUID_PATTERN.test(args[1] ?? '')
    ) {
        console.error(
            'Usage: npm run db:seed:demo -- --user-id <existing-active-user-uuid>',
        );
        return null;
    }

    return args[1] ?? null;
}

function getUpstreamUrl(definition: ApiDefinition): string {
    const configured = process.env[definition.urlEnvironmentVariable];
    const value = configured ??
        `http://${definition.defaultHostname}:${definition.defaultPort}`;
    let parsed: URL;

    try {
        parsed = new URL(value);
    } catch {
        throw new DemoSeedError(
            `${definition.urlEnvironmentVariable} must be a valid HTTP(S) origin.`,
        );
    }

    if (
        parsed.pathname !== '/' ||
        parsed.search ||
        parsed.hash ||
        parsed.username ||
        parsed.password
    ) {
        throw new DemoSeedError(
            `${definition.urlEnvironmentVariable} must contain only an HTTP(S) origin.`,
        );
    }

    return validateCreateApiInput({
        name: definition.name,
        description: definition.description,
        upstreamUrl: parsed.origin,
        upstreamBasePath: definition.upstreamBasePath,
    }).upstreamUrl;
}

function getDefaultHealthCheckPath(
    definition: ApiDefinition,
    upstreamUrl: string,
): string {
    const normalizedBasePath = definition.upstreamBasePath
        ? `/${definition.upstreamBasePath.replace(/^\/+|\/+$/g, '')}`
        : '';
    const resolved = new URL(upstreamUrl);
    resolved.pathname = `${normalizedBasePath}/../health`;
    if (resolved.pathname !== '/health') {
        throw new DemoSeedError(
            `The health-check path for ${definition.name} does not resolve to /health; no configuration was written.`,
        );
    }
    return '/../health';
}

function decodeJson(value: unknown): unknown {
    if (typeof value !== 'string') {
        return value;
    }
    try {
        return JSON.parse(value) as unknown;
    } catch {
        return value;
    }
}

function normalizeJson(value: unknown): unknown {
    const decoded = decodeJson(value);
    if (Array.isArray(decoded)) {
        return decoded.map(normalizeJson);
    }
    if (typeof decoded === 'object' && decoded !== null) {
        return Object.fromEntries(
            Object.entries(decoded)
                .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
                .map(([key, nestedValue]) => [key, normalizeJson(nestedValue)]),
        );
    }
    return decoded;
}

function sameJson(left: unknown, right: unknown): boolean {
    return JSON.stringify(normalizeJson(left)) === JSON.stringify(normalizeJson(right));
}

function testIsCanonical(
    row: Record<string, unknown>,
    definition: TestDefinition,
    upstreamUrl: string,
): boolean {
    const url = new URL(definition.path, upstreamUrl).toString();
    return row.method === 'GET' &&
        row.path === definition.path &&
        row.url === url &&
        row.status === 'ACTIVE' &&
        row.deleted_at === null &&
        row.body === null &&
        Number(row.timeout_ms) === 5_000 &&
        sameJson(row.headers, {}) &&
        sameJson(row.authentication, { type: 'NONE' }) &&
        sameJson(row.assertions, definition.assertions);
}

async function checkDatabaseSchema(): Promise<void> {
    if (!await database.schema.hasTable('knex_migrations')) {
        throw new DemoSeedError(
            'GateWatch migrations have not been applied. Run `npm run db:migrate` from the backend directory first.',
        );
    }

    const missingTables: string[] = [];
    for (const table of REQUIRED_TABLES) {
        if (!await database.schema.hasTable(table)) {
            missingTables.push(table);
        }
    }

    if (missingTables.length > 0) {
        throw new DemoSeedError(
            `The database schema is incomplete (missing ${missingTables.join(', ')}). Run \`npm run db:migrate\` from the backend directory.`,
        );
    }
}

async function seedConfiguration(userId: string): Promise<DemoSeedResult> {
    return database.transaction(async (transaction) => {
        await transaction.raw(
            'SELECT pg_advisory_xact_lock(hashtext(?))',
            [`${SEED_MARKER}:${userId}`],
        );

        const user = await transaction('users')
            .where({ id: userId })
            .forUpdate()
            .first('id', 'status', 'deleted_at');

        if (!user || user.status !== 'ACTIVE' || user.deleted_at !== null) {
            throw new DemoSeedError(
                'The supplied user does not exist or is not an active, non-deleted GateWatch account. Sign in with an eligible account and use its UUID.',
            );
        }

        const ownerSlug = userId.replaceAll('-', '');
        const projectsByKey = new Map<string, { id: string; slug: string }>();
        const projectSlugs: Record<string, string> = {};
        let createdProjects = 0;
        for (const definition of projectDefinitions) {
            const projectSlug = `gatewatch-${definition.key}-${ownerSlug}`;
            const projectDescription =
                `GateWatch demo project ${SEED_MARKER}: ${definition.key}.`;
            let project = await transaction('projects')
                .where({ slug: projectSlug })
                .forUpdate()
                .first('*');
            if (project) {
                if (
                    project.user_id !== userId ||
                    project.name !== definition.name ||
                    project.description !== projectDescription ||
                    project.status !== 'ACTIVE' ||
                    project.deleted_at !== null
                ) {
                    throw new DemoSeedError(
                        `The deterministic ${definition.name} project identifier conflicts with a different, modified, or deleted project. No existing project was changed.`,
                    );
                }
            } else {
                const conflictingProject = await transaction('projects')
                    .where({ user_id: userId, name: definition.name })
                    .first('id');
                if (conflictingProject) {
                    throw new DemoSeedError(
                        `This account already has a project named ${definition.name} that is not owned by this seed workflow. The seed will not alter or replace it, including if it is soft-deleted.`,
                    );
                }
                [project] = await transaction('projects')
                    .insert({
                        user_id: userId,
                        name: definition.name,
                        slug: projectSlug,
                        description: projectDescription,
                        status: 'ACTIVE',
                    })
                    .returning('*');
                createdProjects += 1;
            }
            projectsByKey.set(definition.key, {
                id: project.id,
                slug: project.slug,
            });
            projectSlugs[definition.key] = project.slug;
        }

        const legacySlug = `gatewatch-demo-${ownerSlug}`;
        const legacyProject = await transaction('projects')
            .where({ slug: legacySlug })
            .forUpdate()
            .first('*');
        if (
            legacyProject &&
            (legacyProject.user_id !== userId ||
                legacyProject.name !== LEGACY_PROJECT_NAME ||
                legacyProject.description !== LEGACY_PROJECT_DESCRIPTION)
        ) {
            throw new DemoSeedError(
                'The legacy demo project identifier belongs to a modified or different project. No existing project was changed.',
            );
        }
        if (legacyProject && (legacyProject.status !== 'ACTIVE' ||
            legacyProject.deleted_at !== null)) {
            const legacyApi = await transaction('apis')
                .where({ project_id: legacyProject.id })
                .first('id');
            if (legacyApi) {
                throw new DemoSeedError(
                    'The legacy demo project is disabled or soft-deleted and still contains APIs. Review it manually; the seed will not restore or duplicate those registrations.',
                );
            }
        }

        let createdApis = 0;
        let createdRoutes = 0;
        let createdTests = 0;
        let createdAlerts = 0;
        const preservedConfigurations: string[] = [];
        const seededApis: SeededApi[] = [];
        const seededTests: SeededTest[] = [];

        for (const definition of definitions) {
            const upstreamUrl = getUpstreamUrl(definition);
            const project = projectsByKey.get(definition.projectKey);
            if (!project) {
                throw new DemoSeedError(
                    `Missing project definition for ${definition.name}.`,
                );
            }
            let api = await transaction('apis')
                .where({
                    project_id: project.id,
                    name: definition.name,
                })
                .forUpdate()
                .first('*');

            const legacyApi = legacyProject
                ? await transaction('apis')
                    .where({
                        project_id: legacyProject.id,
                        name: definition.name,
                    })
                    .forUpdate()
                    .first('*')
                : null;
            if (api && legacyApi) {
                throw new DemoSeedError(
                    `Both legacy and new ${definition.name} registrations exist. Resolve the duplicate manually; neither was changed.`,
                );
            }
            if (!api && legacyApi) {
                if (
                    legacyApi.description !== definition.description ||
                    legacyApi.deleted_at !== null ||
                    legacyApi.status === 'DELETED'
                ) {
                    throw new DemoSeedError(
                        `The legacy ${definition.name} registration is modified or soft-deleted. It was not moved or restored.`,
                    );
                }
                if (
                    legacyApi.upstream_url !== upstreamUrl ||
                    legacyApi.upstream_base_path !== definition.upstreamBasePath
                ) {
                    throw new DemoSeedError(
                        `The legacy ${definition.name} upstream URL or base path was modified. Update or review it manually before moving the registration; the seed will not overwrite it.`,
                    );
                }
                const legacyRoutes = await transaction('api_routes')
                    .where({ api_id: legacyApi.id })
                    .forUpdate()
                    .select('*');
                for (const legacyRoute of legacyRoutes) {
                    const destinationConflict = await transaction('api_routes')
                        .where({
                            project_id: project.id,
                            path_prefix: legacyRoute.path_prefix,
                            method: legacyRoute.method,
                        })
                        .whereNot({ id: legacyRoute.id })
                        .first('id');
                    if (destinationConflict) {
                        throw new DemoSeedError(
                            `Moving ${definition.name} would conflict with an existing ${legacyRoute.method} ${legacyRoute.path_prefix} route in ${definition.projectKey}. No route was changed.`,
                        );
                    }
                }
                await transaction('api_routes')
                    .where({ api_id: legacyApi.id })
                    .update({
                        project_id: project.id,
                    });
                [api] = await transaction('apis')
                    .where({ id: legacyApi.id })
                    .update({
                        project_id: project.id,
                        version: transaction.raw('version + 1'),
                        updated_at: transaction.fn.now(),
                    })
                    .returning('*');
                preservedConfigurations.push(
                    `Moved existing seed-owned ${definition.name} registration into ${definition.projectKey} without changing its upstream configuration.`,
                );
            }

            if (api) {
                if (
                    api.description !== definition.description ||
                    api.deleted_at !== null ||
                    api.status === 'DELETED'
                ) {
                    throw new DemoSeedError(
                        `The ${definition.name} registration conflicts with an existing or deleted API. No existing API was changed.`,
                    );
                }
                if (
                    api.upstream_url !== upstreamUrl ||
                    api.upstream_base_path !== definition.upstreamBasePath
                ) {
                    throw new DemoSeedError(
                        `The ${definition.name} upstream URL or base path differs from the seed configuration. Review the existing values and environment configuration; the seed will not overwrite them.`,
                    );
                }
            } else {
                [api] = await transaction('apis')
                    .insert({
                        project_id: project.id,
                        name: definition.name,
                        description: definition.description,
                        upstream_url: upstreamUrl,
                        upstream_base_path: definition.upstreamBasePath,
                        status: 'ACTIVE',
                        auth_required: false,
                    })
                    .returning('*');
                createdApis += 1;
            }

            seededApis.push({
                id: api.id,
                name: api.name,
                status: api.status,
                upstreamUrl: api.upstream_url,
                projectSlug: project.slug,
            });

            const existingApiRoutes = await transaction('api_routes')
                .where({ api_id: api.id })
                .select('*');
            for (const routeDefinition of definition.routes) {
                const route = await transaction('api_routes')
                    .where({
                        project_id: project.id,
                        path_prefix: routeDefinition.pathPrefix,
                        method: routeDefinition.method,
                    })
                    .forUpdate()
                    .first('*');

                if (route) {
                    if (
                        route.api_id !== api.id ||
                        route.deleted_at !== null
                    ) {
                        throw new DemoSeedError(
                            `The ${routeDefinition.method} ${routeDefinition.pathPrefix} gateway route conflicts with an existing or deleted route. No route was changed.`,
                        );
                    }
                    if (!route.is_active) {
                        preservedConfigurations.push(
                            `Preserved disabled ${routeDefinition.method} ${routeDefinition.pathPrefix} route for ${definition.name}.`,
                        );
                    }
                } else {
                    if (existingApiRoutes.length > 0) {
                        throw new DemoSeedError(
                            `${definition.name} has existing gateway routes but is missing ${routeDefinition.method} ${routeDefinition.pathPrefix}. The seed will not replace a possibly modified route configuration.`,
                        );
                    }
                    await transaction('api_routes').insert({
                        api_id: api.id,
                        project_id: project.id,
                        path_prefix: routeDefinition.pathPrefix,
                        method: routeDefinition.method,
                        is_active: true,
                    });
                    createdRoutes += 1;
                }
            }

            const existingRateLimit = await transaction('rate_limit_configs')
                .where({ api_id: api.id })
                .first('id');
            if (!existingRateLimit) {
                await transaction('rate_limit_configs').insert({
                    api_id: api.id,
                    enabled: true,
                    request_limit: 120,
                    window_seconds: 60,
                });
            } else {
                const rateLimit = await transaction('rate_limit_configs')
                .where({ api_id: api.id })
                .first('*');
                if (
                !rateLimit.enabled ||
                Number(rateLimit.request_limit) !== 120 ||
                Number(rateLimit.window_seconds) !== 60
                ) {
                preservedConfigurations.push(
                    `Preserved customized rate-limit settings for ${definition.name}.`,
                );
                }
            }

            const existingHealthConfig = await transaction('health_check_configs')
                .where({ api_id: api.id })
                .first('*');
            const healthPath = getDefaultHealthCheckPath(definition, upstreamUrl);
            if (!existingHealthConfig) {
                await transaction('health_check_configs').insert({
                api_id: api.id,
                enabled: true,
                path: healthPath,
                    interval_seconds: 60,
                    timeout_ms: 5_000,
                    expected_status_min: 200,
                    expected_status_max: 299,
                    latency_threshold_ms: 1_500,
                });
            } else if (
                !existingHealthConfig.enabled ||
                existingHealthConfig.path !== healthPath ||
                Number(existingHealthConfig.interval_seconds) !== 60 ||
                Number(existingHealthConfig.timeout_ms) !== 5_000 ||
                Number(existingHealthConfig.expected_status_min) !== 200 ||
                Number(existingHealthConfig.expected_status_max) !== 299 ||
                Number(existingHealthConfig.latency_threshold_ms) !== 1_500
            ) {
                preservedConfigurations.push(
                    `Preserved customized health-check settings for ${definition.name}; configured path ${existingHealthConfig.path} was not changed.`,
                );
            }

            for (const alertDefinition of definition.alerts) {
                const existingAlerts = await transaction('alerts')
                    .where({
                        api_id: api.id,
                        name: alertDefinition.name,
                    })
                    .forUpdate()
                    .select('*');
                if (existingAlerts.length > 1) {
                    throw new DemoSeedError(
                        `Multiple alerts named "${alertDefinition.name}" already exist. Resolve the duplicate before rerunning the seed.`,
                    );
                }
                if (existingAlerts.length === 1) {
                    const existingAlert = existingAlerts[0];
                    if (
                        existingAlert?.type !== alertDefinition.type ||
                        existingAlert.deleted_at !== null
                    ) {
                        throw new DemoSeedError(
                            `The alert "${alertDefinition.name}" conflicts with an existing or deleted alert. No alert was changed.`,
                        );
                    }
                    if (
                        existingAlert.status !== 'ACTIVE' ||
                        !existingAlert.enabled ||
                        !sameJson(
                            existingAlert.configuration,
                            alertDefinition.configuration,
                        )
                    ) {
                        preservedConfigurations.push(
                            `Preserved customized or disabled alert "${alertDefinition.name}".`,
                        );
                    }
                } else {
                    await transaction('alerts').insert({
                        api_id: api.id,
                        name: alertDefinition.name,
                        type: alertDefinition.type,
                        status: 'ACTIVE',
                        enabled: true,
                        configuration: transaction.raw(
                            '?::jsonb',
                            [JSON.stringify(alertDefinition.configuration)],
                        ),
                        runtime_state: 'INACTIVE',
                    });
                    createdAlerts += 1;
                }
            }

            for (const testDefinition of definition.tests) {
                const url = new URL(testDefinition.path, upstreamUrl).toString();
                const input = validateTestInput(
                    {
                        name: testDefinition.name,
                        method: 'GET',
                        url,
                        headers: {},
                        body: null,
                        authentication: { type: 'NONE' },
                        assertions: testDefinition.assertions,
                        timeoutMs: 5_000,
                    },
                    upstreamUrl,
                ) as TestInput;
                const existingTests = await transaction('tests')
                    .where({
                        api_id: api.id,
                        name: testDefinition.name,
                    })
                    .forUpdate()
                    .select('*');

                if (existingTests.length > 1) {
                    throw new DemoSeedError(
                        `Multiple tests named "${testDefinition.name}" already exist. Resolve the duplicate before rerunning the seed.`,
                    );
                }

                let testId: string;
                let canonical: boolean;
                const existingTest = existingTests[0];
                if (existingTest) {
                    if (existingTest.deleted_at !== null) {
                        throw new DemoSeedError(
                            `The test "${testDefinition.name}" has been deleted. It was not recreated or restored.`,
                        );
                    }
                    testId = existingTest.id;
                    canonical = testIsCanonical(
                        existingTest,
                        testDefinition,
                        upstreamUrl,
                    );
                    if (!canonical) {
                        preservedConfigurations.push(
                            `Preserved customized or disabled test "${testDefinition.name}"; it will not be executed by the seed.`,
                        );
                    }
                } else {
                    const [createdTest] = await transaction('tests')
                        .insert({
                            api_id: api.id,
                            name: input.name,
                            method: input.method,
                            path: testDefinition.path,
                            url: input.url,
                            headers: transaction.raw(
                                '?::jsonb',
                                [JSON.stringify(input.headers)],
                            ),
                            body: null,
                            authentication: transaction.raw(
                                '?::jsonb',
                                [JSON.stringify({ type: 'NONE' })],
                            ),
                            assertions: transaction.raw(
                                '?::jsonb',
                                [JSON.stringify(input.assertions)],
                            ),
                            timeout_ms: input.timeoutMs,
                            status: 'ACTIVE',
                        })
                        .returning(['id']);
                    testId = createdTest.id;
                    canonical = true;
                    createdTests += 1;
                }

                seededTests.push({
                    id: testId,
                    name: testDefinition.name,
                    apiId: api.id,
                    apiName: api.name,
                    apiStatus: api.status,
                    canonical,
                });
            }
        }

        if (legacyProject && legacyProject.status === 'ACTIVE' &&
            legacyProject.deleted_at === null) {
            const remainingLegacyApi = await transaction('apis')
                .where({ project_id: legacyProject.id })
                .first('id');
            if (!remainingLegacyApi) {
                await transaction('projects')
                    .where({ id: legacyProject.id })
                    .update({
                        status: 'DELETED',
                        deleted_at: transaction.fn.now(),
                        updated_at: transaction.fn.now(),
                    });
                preservedConfigurations.push(
                    'Soft-deleted the now-empty legacy seed project after moving its seed-owned API registrations.',
                );
            } else {
                preservedConfigurations.push(
                    'Kept the legacy demo project because it still contains other API registrations.',
                );
            }
        }

        return {
            projectSlugs,
            createdProjects,
            apis: seededApis,
            tests: seededTests,
            createdApis,
            createdRoutes,
            createdTests,
            createdAlerts,
            preservedConfigurations,
        };
    });
}

async function generateRealActivity(
    userId: string,
    result: DemoSeedResult,
): Promise<void> {
    for (const api of result.apis) {
        if (api.status !== 'ACTIVE') {
            console.log(`Health check skipped for ${api.name}: API status is ${api.status}.`);
            continue;
        }

        try {
            const check = await runUserHealthCheck(userId, api.id);
            console.log(
                `Health check ${api.name}: ${check.status}${check.httpStatus ? ` (HTTP ${check.httpStatus})` : ''}.`,
            );
        } catch {
            console.warn(`Health check for ${api.name} did not complete; no result was reported as successful.`);
        }
    }

    for (const test of result.tests) {
        if (!test.canonical || test.apiStatus === 'DISABLED') {
            console.log(`Test skipped for ${test.apiName}: its demo definition was edited or its API is disabled.`);
            continue;
        }

        try {
            const execution = await executeUserTest(userId, test.id);
            console.log(
                `Test ${test.name}: ${execution.status}${execution.result.responseStatus ? ` (HTTP ${execution.result.responseStatus})` : ''}.`,
            );
        } catch {
            console.warn(`Test ${test.name} could not be executed; no execution was reported.`);
        }
    }

    const backendUrl = process.env.GATEWATCH_BACKEND_URL ??
        `http://127.0.0.1:${process.env.BACKEND_PORT ?? '4000'}`;
    let gatewayOrigin: URL;
    try {
        gatewayOrigin = new URL(backendUrl);
    } catch {
        console.warn('Gateway activity skipped: GATEWATCH_BACKEND_URL is not a valid URL.');
        return;
    }

    if (
        !['http:', 'https:'].includes(gatewayOrigin.protocol) ||
        gatewayOrigin.username ||
        gatewayOrigin.password ||
        !['localhost', '127.0.0.1', '[::1]', '::1'].includes(gatewayOrigin.hostname)
    ) {
        console.warn('Gateway activity skipped: GATEWATCH_BACKEND_URL must point to the local backend.');
        return;
    }

    const requests = [
        { projectKey: 'product-management', path: '/products', expectedStatus: 200 },
        { projectKey: 'product-management', path: '/products/search?q=phone', expectedStatus: 200 },
        { projectKey: 'product-management', path: '/products/1/stock', expectedStatus: 200 },
        { projectKey: 'product-management', path: '/categories', expectedStatus: 200 },
        { projectKey: 'order-management', path: '/orders', expectedStatus: 200 },
        { projectKey: 'order-management', path: '/orders/1/items', expectedStatus: 200 },
        { projectKey: 'order-management', path: '/orders/999', expectedStatus: 404 },
        { projectKey: 'user-management', path: '/users', expectedStatus: 200 },
        { projectKey: 'user-management', path: '/users/1/orders', expectedStatus: 200 },
    ];

    for (const request of requests) {
        const projectSlug = result.projectSlugs[request.projectKey];
        if (!projectSlug) {
            throw new DemoSeedError(
                `Missing gateway project slug for ${request.projectKey}.`,
            );
        }
        const url = new URL(`/p/${projectSlug}${request.path}`, gatewayOrigin);
        try {
            const response = await fetch(url, {
                method: 'GET',
                signal: AbortSignal.timeout(5_000),
            });
            await response.body?.cancel();
            console.log(
                `Gateway ${request.path}: HTTP ${response.status}${response.status === request.expectedStatus ? '' : ` (expected ${request.expectedStatus})`}.`,
            );
        } catch {
            console.warn(
                `Gateway activity stopped at ${request.path}: the local backend could not be reached. Start GateWatch and rerun the seed to generate request history.`,
            );
            return;
        }
    }
}

async function main(): Promise<void> {
    const userId = getUserIdArgument(process.argv.slice(2));
    if (!userId) {
        process.exitCode = 2;
        return;
    }

    try {
        try {
            await database.raw('SELECT 1');
        } catch {
            throw new DemoSeedError(
                'PostgreSQL is unavailable. Start the GateWatch database and verify POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB, POSTGRES_USER, and POSTGRES_PASSWORD. No seed changes were made.',
            );
        }

        await checkDatabaseSchema();
        const result = await seedConfiguration(userId);
        console.log(
            `Demo configuration ready for ${userId}: ${projectDefinitions.length} projects (${result.createdProjects} created), ${result.apis.length} API registrations (${result.createdApis} created), ${result.createdRoutes} routes created, ${result.createdTests} tests created, and ${result.createdAlerts} alerts created.`,
        );
        for (const project of projectDefinitions) {
            console.log(
                `Project ${project.name}: ${result.projectSlugs[project.key]}.`,
            );
        }
        for (const message of result.preservedConfigurations) {
            console.warn(message);
        }
        if (result.createdProjects === 0 && result.createdApis === 0 && result.createdRoutes === 0 &&
            result.createdTests === 0 && result.createdAlerts === 0) {
            console.log('Configuration was already present; no duplicate demo records were created.');
        }

        await generateRealActivity(userId, result);
    } catch (error) {
        if (error instanceof DemoSeedError) {
            console.error(error.message);
        } else {
            const detail = error instanceof Error
                ? error.message
                    .replace(
                        /(password|secret|token|credential)(\s*[:=]\s*)[^\s,;]+/gi,
                        '$1$2[redacted]',
                    )
                    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, 'postgres://[redacted]@')
                : 'Unknown error.';
            console.error(
                `Demo seeding failed: ${detail}. The configuration transaction was rolled back if it had not committed. No credentials were printed.`,
            );
        }
        process.exitCode = 1;
    } finally {
        try {
            await database.destroy();
        } catch {
            console.error('The database connection pool could not be closed cleanly.');
            process.exitCode = 1;
        }
    }
}

void main();
