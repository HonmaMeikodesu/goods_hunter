# Getting Started

<cite>
**Referenced Files in This Document**  
- [README.md](file://README.md)
- [package.json](file://package.json)
- [bootstrap.js](file://bootstrap.js)
- [src/config/config.default.ts](file://src/config/config.default.ts)
- [src/config/config.local.ts](file://src/config/config.local.ts)
- [src/configuration.ts](file://src/configuration.ts)
- [src/model/user.ts](file://src/model/user.ts)
- [src/service/register.ts](file://src/service/register.ts)
- [src/controller/register.ts](file://src/controller/register.ts)
- [src/controller/login.ts](file://src/controller/login.ts)
- [jest.config.js](file://jest.config.js)
- [jest.setup.js](file://jest.setup.js)
- [test/controller/api.test.ts](file://test/controller/api.test.ts)
</cite>

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Cloning the Repository](#cloning-the-repository)
3. [Installing Dependencies](#installing-dependencies)
4. [Configuring Environment Variables](#configuring-environment-variables)
5. [Setting Up the Database](#setting-up-the-database)
6. [Starting the Application](#starting-the-application)
7. [Running in Development Mode](#running-in-development-mode)
8. [Executing Tests with Jest](#executing-tests-with-jest)
9. [Basic Usage Examples](#basic-usage-examples)
10. [Common Setup Pitfalls and Solutions](#common-setup-pitfalls-and-solutions)

## Prerequisites

Before setting up the goods_hunter project, ensure your system meets the following requirements:

- **Node.js**: Version 12 or higher (recommended: 16+)
- **MySQL**: Running instance accessible at `127.0.0.1:3306`
- **Redis**: Running instance accessible at `127.0.0.1:6379` with password `honmameiko`

These services are required because the application uses MySQL for persistent data storage (via TypeORM), Redis for session and task scheduling (via @midwayjs/redis and @midwayjs/task), and Node.js as the runtime environment.

**Section sources**
- [package.json](file://package.json#L62-L64)
- [src/config/config.default.ts](file://src/config/config.default.ts#L40-L47)

## Cloning the Repository

To begin, clone the repository from its source:

```bash
git clone git@github.com:HonmaMeikodesu/goods_hunter.git
cd goods_hunter
```

This will download the full project structure, including source code, configuration files, tests, and documentation.

**Section sources**
- [README.md](file://README.md#L8)

## Installing Dependencies

Install all required dependencies using npm:

```bash
npm install
```

This command reads the `package.json` file and installs both production and development dependencies. The project relies on several key packages:
- `@midwayjs/*`: Framework components for building the server application
- `typeorm`: ORM for database interactions
- `redis`: For session and task management
- `jest`: For unit testing

**Section sources**
- [package.json](file://package.json#L6-L58)

## Configuring Environment Variables

The project uses configuration files located in `src/config/`. The main configuration files are:

- `config.default.ts`: Base configuration with default values
- `config.local.ts`: Local development override (disables CSRF for ease of use)
- `config.unittest.ts`: Configuration used during testing

For local development, no additional configuration is needed beyond ensuring MySQL and Redis are running. However, the application expects certain private files (`email.json`, `secret.json`, `server.json`) in the `src/private/` directory. These are not included in the repository and must be created manually if needed for full functionality.

The `config.local.ts` file disables CSRF protection, which is helpful for local development but should not be used in production.

**Section sources**
- [src/config/config.default.ts](file://src/config/config.default.ts#L1-L103)
- [src/config/config.local.ts](file://src/config/config.local.ts#L1-L10)
- [src/configuration.ts](file://src/configuration.ts#L1-L26)

## Setting Up the Database

Ensure MySQL is running and create the database used by the application:

```sql
CREATE DATABASE IF NOT EXISTS goods_hunter;
```

The application uses TypeORM with the `synchronize: true` option, which automatically creates and updates database tables based on the entity models defined in the `src/model/` directory. For example, the `User` entity in `src/model/user.ts` will create a corresponding `user` table with columns for `email`, `password`, `createdAt`, and `updatedAt`.

No manual schema migration is required due to this auto-synchronization feature.

**Section sources**
- [src/config/config.default.ts](file://src/config/config.default.ts#L85-L95)
- [src/model/user.ts](file://src/model/user.ts#L1-L42)

## Starting the Application

Start the application using the bootstrap script:

```bash
npm run dev
```

This command runs the development server using `midway-bin dev` with the `--ts` flag to support TypeScript. The server will start on port 7001, as defined in `bootstrap.js`.

Expected output:
```
Midway Development Server is running at http://127.0.0.1:7001
```

The `bootstrap.js` file initializes the web framework and starts the server with the configured port.

**Section sources**
- [bootstrap.js](file://bootstrap.js#L1-L8)
- [package.json](file://package.json#L67)

## Running in Development Mode

The project provides multiple development scripts:

- `npm run dev`: Standard development mode
- `npm run dev_local`: Uses a different proxy inbound (`localhost:10809`)
- `npm run dev_mock`: Enables mock mode with environment variable `enableMock=1`

These scripts are useful for different development scenarios, such as testing with different proxy configurations or using mocked API responses.

**Section sources**
- [package.json](file://package.json#L67-L69)

## Executing Tests with Jest

Run unit tests using Jest:

```bash
npm test
```

This executes the test suite defined in the `test/` directory. The configuration is set in `jest.config.js`, which specifies:
- `preset: 'ts-jest'` for TypeScript support
- `testEnvironment: 'node'` for backend testing
- `setupFilesAfterEnv: ['./jest.setup.js']` to set global test timeout

An example test in `test/controller/api.test.ts` verifies that a POST request to `/api/get_user` returns a 200 status code.

**Section sources**
- [jest.config.js](file://jest.config.js#L1-L8)
- [jest.setup.js](file://jest.setup.js#L1-L2)
- [test/controller/api.test.ts](file://test/controller/api.test.ts#L1-L28)

## Basic Usage Examples

### Registering a User

Send a POST request to `/register` with email and password:

```bash
curl -X POST http://127.0.0.1:7001/register \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "password123"}'
```

This triggers the `RegisterService`, which generates a verification code and stores it in Redis. In a real setup, it would send an email for confirmation.

**Section sources**
- [src/controller/register.ts](file://src/controller/register.ts#L23-L33)
- [src/service/register.ts](file://src/service/register.ts#L14-L77)

### Logging In

Send a POST request to `/login`:

```bash
curl -X POST http://127.0.0.1:7001/login \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "password123"}'
```

On success, the server sets a `loginState` cookie.

**Section sources**
- [src/controller/login.ts](file://src/controller/login.ts#L22-L36)

### Creating a Monitoring Task

The application supports monitoring products on platforms like Mercari and Yahoo Auctions. While specific API endpoints for creating hunters are not shown in the provided code, the data models (`MercariHunter`, `YahooHunter`) suggest that users can define search conditions and schedules.

These tasks are likely managed by the `@midwayjs/task` module, which integrates with Redis for cron-based job scheduling.

**Section sources**
- [src/model/user.ts](file://src/model/user.ts#L31-L35)
- [src/config/config.default.ts](file://src/config/config.default.ts#L54-L66)

## Common Setup Pitfalls and Solutions

### Database Connection Issues

**Problem**: Application fails to start with database connection errors.

**Solution**: Ensure MySQL is running and accessible at `127.0.0.1:3306`. Verify the database `goods_hunter` exists and the credentials (`honmameiko`/`honmameiko`) are correct.

**Section sources**
- [src/config/config.default.ts](file://src/config/config.default.ts#L85-L95)

### Redis Not Running

**Problem**: Redis connection errors or task scheduling failures.

**Solution**: Start Redis server on port 6379 with the password `honmameiko`. You can test connectivity using:
```bash
redis-cli -p 6379 -a honmameiko ping
```

**Section sources**
- [src/config/config.default.ts](file://src/config/config.default.ts#L40-L47)

### Missing Private Configuration Files

**Problem**: Errors related to missing `email.json`, `secret.json`, or `server.json`.

**Solution**: Create the `src/private/` directory and add these JSON files with appropriate content. These are required for email notifications and JWT operations.

**Section sources**
- [src/config/config.default.ts](file://src/config/config.default.ts#L68-L72)

### Port Already in Use

**Problem**: Server fails to start due to port 7001 being occupied.

**Solution**: Change the port in `bootstrap.js` or stop the process currently using port 7001.

**Section sources**
- [bootstrap.js](file://bootstrap.js#L3)