# Testing Strategy

<cite>
**Referenced Files in This Document**   
- [jest.config.js](file://jest.config.js)
- [jest.setup.js](file://jest.setup.js)
- [package.json](file://package.json)
- [test/controller/home.test.ts](file://test/controller/home.test.ts)
- [test/controller/api.test.ts](file://test/controller/api.test.ts)
- [src/mock/api.ts](file://src/mock/api.ts)
- [src/controller/home.ts](file://src/controller/home.ts)
- [src/controller/goods.ts](file://src/controller/goods.ts)
- [src/service/goods.ts](file://src/service/goods.ts)
- [src/service/email.ts](file://src/service/email.ts)
- [src/config/config.unittest.ts](file://src/config/config.unittest.ts)
</cite>

## Table of Contents
1. [Testing Framework and Configuration](#testing-framework-and-configuration)
2. [Integration Test Structure](#integration-test-structure)
3. [Mocking Strategy](#mocking-strategy)
4. [Test Execution and Coverage](#test-execution-and-coverage)
5. [Writing New Tests](#writing-new-tests)
6. [Testing Challenges and Solutions](#testing-challenges-and-solutions)
7. [Best Practices](#best-practices)

## Testing Framework and Configuration

The goods_hunter application uses Jest as its primary testing framework, configured specifically for Node.js environment testing with TypeScript support. The Jest configuration is defined in jest.config.js, which sets up the testing environment with the ts-jest preset for TypeScript compilation and specifies node as the test environment. The configuration includes testPathIgnorePatterns to exclude fixture files from testing and coveragePathIgnorePatterns to exclude test files from coverage reports. The setupFilesAfterEnv configuration points to jest.setup.js, which sets a global timeout of 30 seconds for all tests to accommodate potentially slow operations.

The package.json file defines the test scripts, with "test" running midway-bin test --ts for executing tests and "cov" running midway-bin cov --ts for generating coverage reports. The application leverages MidwayJS's testing utilities, including @midwayjs/mock for creating application instances and making HTTP requests during tests. The testing configuration also includes unittest-specific settings in config.unittest.ts, which disables CSRF protection during testing to simplify request validation.

**Section sources**
- [jest.config.js](file://jest.config.js#L1-L7)
- [jest.setup.js](file://jest.setup.js#L1-L2)
- [package.json](file://package.json#L70-L71)
- [src/config/config.unittest.ts](file://src/config/config.unittest.ts#L1-L3)

## Integration Test Structure

Integration tests are organized in the test/controller/ directory, validating HTTP endpoints for both authentication and API functionality. Each test file follows a standard structure using Jest's describe, beforeAll, afterAll, and it functions to define test suites and individual test cases. The tests create a full application instance using createApp from @midwayjs/mock before all tests run, ensuring that the entire application stack is available for testing. This approach allows for comprehensive testing of controller logic, middleware execution, and route handling.

The home.test.ts file demonstrates a basic GET request test, verifying that the root endpoint returns a 200 status code and the expected response text. Similarly, api.test.ts tests a POST request with query parameters, validating both the HTTP status and response body structure. Tests use both Jest's expect assertions and Node.js assert library for flexibility in assertion patterns. The integration tests cover various HTTP methods (GET, POST) and validate both successful responses and error conditions through proper request construction.

**Section sources**
- [test/controller/home.test.ts](file://test/controller/home.test.ts#L1-L32)
- [test/controller/api.test.ts](file://test/controller/api.test.ts#L1-L27)
- [src/controller/home.ts](file://src/controller/home.ts#L1-L27)
- [src/controller/goods.ts](file://src/controller/goods.ts#L1-L153)

## Mocking Strategy

The application employs a sophisticated mocking strategy to simulate external responses without performing live scraping operations. The core of this strategy is implemented in src/mock/api.ts, which defines an ApiMock class decorated with @Mock() and implementing ISimulation. This mock class intercepts and replaces actual API calls to external services like Mercari, Yahoo Auction, and Surugaya with responses from local mock files. The mock implementation overrides the proxyGet and proxyPost methods to return pre-recorded HTML, JSON, or text responses stored in the src/api/site/*/mock/ directories.

For each external service, the mock not only returns static content but also enhances it with dynamic elements like unique IDs and updated timestamps to simulate realistic data variations. The mocking system also intercepts email delivery through mockService.mockClassProperty, redirecting email sends to console output instead of actual delivery. The mock system is conditionally enabled based on the enableMock environment variable, allowing seamless switching between real and mocked behavior. This approach enables comprehensive testing of the application's core functionality without dependencies on external APIs, network connectivity, or rate limiting.

**Section sources**
- [src/mock/api.ts](file://src/mock/api.ts#L1-L96)
- [src/api/site/mercari/mock/goodsList.json](file://src/api/site/mercari/mock/goodsList.json)
- [src/api/site/yahoo/mock/goodsList.html](file://src/api/site/yahoo/mock/goodsList.html)
- [src/api/site/surugaya/mock/goodsList.html](file://src/api/site/surugaya/mock/goodsList.html)
- [src/service/email.ts](file://src/service/email.ts#L1-L30)

## Test Execution and Coverage

Tests are executed using the npm test command, which runs midway-bin test --ts to execute all test files with TypeScript support. For coverage reporting, the npm run cov command generates detailed coverage reports using midway-bin cov --ts. The Jest configuration excludes test files from coverage calculations through coveragePathIgnorePatterns, focusing coverage metrics on production code. The test setup includes a global timeout extension to 30 seconds, accommodating potentially slow operations during testing.

The testing workflow supports different execution modes, including a mock-enabled development mode (dev_mock) that sets the enableMock environment variable. This allows developers to run the application with mocked external services, facilitating testing without actual API calls. The test environment is automatically configured through the unittest configuration, ensuring consistent test conditions across different environments. Coverage goals should focus on critical paths including authentication flows, goods watcher management, and error handling scenarios.

**Section sources**
- [package.json](file://package.json#L69-L71)
- [jest.config.js](file://jest.config.js#L6-L7)
- [jest.setup.js](file://jest.setup.js#L1-L2)
- [src/config/config.unittest.ts](file://src/config/config.unittest.ts#L1-L3)

## Writing New Tests

When writing new tests for controllers, services, and middleware, follow the established patterns in the existing test files. For controller tests, import createApp, close, and createHttpRequest from @midwayjs/mock to create a full application instance and make HTTP requests. Structure tests with beforeAll to initialize the application and afterAll to clean up resources. Use descriptive test names with the "should" pattern to clearly express expected behavior.

For service testing, consider both integration and unit testing approaches. Integration tests can use the same application setup as controller tests, while unit tests may require manual dependency injection or mocking of specific services. When testing middleware, ensure that the test environment includes the middleware in the application configuration. For async testing, always use async/await patterns and ensure that promises are properly resolved in assertions. Follow the assertion patterns demonstrated in existing tests, using both expect and assert libraries as appropriate for the test scenario.

**Section sources**
- [test/controller/home.test.ts](file://test/controller/home.test.ts#L1-L32)
- [test/controller/api.test.ts](file://test/controller/api.test.ts#L1-L27)
- [src/controller/goods.ts](file://src/controller/goods.ts#L1-L153)
- [src/service/goods.ts](file://src/service/goods.ts#L1-L66)

## Testing Challenges and Solutions

Testing cron jobs, email delivery, and external API integrations presents specific challenges that are addressed through strategic mocking. Cron job testing is facilitated by the mock environment, which allows verification of job scheduling and execution logic without waiting for actual time-based triggers. Email delivery is intercepted by the ApiMock class, which replaces the sendEmail method with a console logging function, enabling verification of email content and structure without actual email transmission.

External API integrations are handled through comprehensive response mocking, with pre-recorded responses for various endpoints stored in the mock directories. This approach allows testing of different response scenarios, including success cases, error conditions, and edge cases, without relying on external services. The mocking system preserves the structure of real responses while adding deterministic variations to test data processing logic. For debugging failed tests, leverage the detailed console output from mocked email services and API responses to trace the flow of data through the application.

**Section sources**
- [src/mock/api.ts](file://src/mock/api.ts#L86-L88)
- [src/service/email.ts](file://src/service/email.ts#L22-L27)
- [src/api/site/mercari/index.ts](file://src/api/site/mercari/index.ts#L1-L52)

## Best Practices

To maintain reliable and fast tests, follow these best practices: Keep tests focused on specific functionality rather than creating overly broad integration tests. Use the mock system consistently to avoid external dependencies and ensure test reproducibility. Organize tests with clear, descriptive names that express the expected behavior. Clean up resources in afterAll or afterEach hooks to prevent test pollution.

Prioritize testing critical user flows, including authentication, goods watcher registration, and notification delivery. Maintain high test coverage for error handling paths and edge cases. Run tests frequently during development and integrate them into the CI/CD pipeline using the provided ci script. When adding new features, write tests first to ensure comprehensive coverage from the beginning. Regularly review and refactor tests to keep them maintainable as the codebase evolves.

**Section sources**
- [jest.config.js](file://jest.config.js#L1-L7)
- [src/mock/api.ts](file://src/mock/api.ts#L1-L96)
- [package.json](file://package.json#L74-L75)
- [test/controller/home.test.ts](file://test/controller/home.test.ts#L1-L32)