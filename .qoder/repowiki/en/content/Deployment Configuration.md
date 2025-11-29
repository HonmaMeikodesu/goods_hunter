# Deployment Configuration

<cite>
**Referenced Files in This Document**   
- [bootstrap.js](file://bootstrap.js)
- [package.json](file://package.json)
- [external/nginx.conf](file://external/nginx.conf)
- [jest.config.js](file://jest.config.js)
- [src/configuration.ts](file://src/configuration.ts)
- [src/config/config.default.ts](file://src/config/config.default.ts)
- [src/config/config.local.ts](file://src/config/config.local.ts)
- [src/config/plugin.ts](file://src/config/plugin.ts)
- [src/middleware/errorCatch.ts](file://src/middleware/errorCatch.ts)
- [src/service/goods.ts](file://src/service/goods.ts)
- [src/errorCode.ts](file://src/errorCode.ts)
</cite>

## Table of Contents
1. [Application Entry Point and Runtime Integration](#application-entry-point-and-runtime-integration)
2. [Nginx Reverse Proxy Configuration](#nginx-reverse-proxy-configuration)
3. [Database Setup: MySQL and Redis](#database-setup-mysql-and-redis)
4. [Process Management and System Integration](#process-management-and-system-integration)
5. [Environment Configuration and CI/CD Considerations](#environment-configuration-and-ci-cd-considerations)
6. [Scaling and Containerization](#scaling-and-containerization)
7. [Testing and Pre-Deployment Validation](#testing-and-pre-deployment-validation)
8. [Troubleshooting Common Deployment Issues](#troubleshooting-common-deployment-issues)

## Application Entry Point and Runtime Integration

The `bootstrap.js` file serves as the primary entry point for the goods_hunter application, responsible for initializing the Midway.js runtime environment and starting the web server. This file configures the web framework with a default port of 7001 and uses the `@midwayjs/bootstrap` module to load and run the application.

The integration with the Midway.js runtime is achieved through the `WebFramework` class from `@midwayjs/web`, which provides a high-level abstraction for building web applications. The bootstrap process loads the configured web framework and executes the application lifecycle, ensuring all components are properly initialized before accepting incoming requests.

Midway.js, built on top of Egg.js, provides a modular and dependency-injection-based architecture that enables clean separation of concerns and testability. The application's configuration system, defined in `src/configuration.ts`, imports necessary modules including web, axios, redis, task scheduling, and ORM functionality.

**Section sources**
- [bootstrap.js](file://bootstrap.js#L1-L8)
- [src/configuration.ts](file://src/configuration.ts#L1-L26)
- [package.json](file://package.json#L6-L31)

## Nginx Reverse Proxy Configuration

The nginx.conf file in the external directory provides a comprehensive reverse proxy configuration for the goods_hunter application. Nginx listens on port 7070 and forwards requests to the Node.js application running on port 7001, providing an abstraction layer that enhances security and performance.

The configuration includes a dedicated proxy cache setup with a 2GB maximum size and 7-day inactivity threshold, specifically configured for the `/proxy/` endpoint. This caching mechanism improves response times for frequently accessed resources and reduces load on the backend application.

Key features of the nginx configuration include:
- Reverse proxying from port 7070 to the application server on port 7001
- HTTP-level proxy caching with a dedicated cache zone named "goods_hunter_cache"
- Cache validity of 3 days for successful (200) responses
- Standard production settings for keepalive, gzip compression, and logging
- MIME type inclusion and basic HTTP optimizations

This setup allows for SSL termination at the nginx level (currently commented out in the configuration), static asset serving, and potential load balancing across multiple application instances in a clustered deployment.

**Section sources**
- [external/nginx.conf](file://external/nginx.conf#L1-L89)
- [bootstrap.js](file://bootstrap.js#L3)

## Database Setup: MySQL and Redis

The application requires both MySQL and Redis for persistent storage and caching, respectively. Configuration for both databases is defined in `src/config/config.default.ts`, with default connection settings pointing to localhost.

For MySQL:
- Host: 127.0.0.1
- Port: 3306
- Username: honmameiko
- Password: honmameiko
- Database: goods_hunter
- TypeORM is used as the ORM with automatic schema synchronization enabled

For Redis:
- Host: 127.0.0.1
- Port: 6379
- Password: honmameiko
- Database: 0
- Used for both general caching and task scheduling via the Midway.js task module

In production, implement the following strategies:
- **Backup**: Schedule regular automated backups of the MySQL database using mysqldump or a similar tool, with encrypted storage and offsite replication
- **Monitoring**: Implement monitoring for both database systems using tools like Prometheus and Grafana to track connection counts, memory usage, query performance, and replication status
- **Security**: Change default passwords, configure firewall rules to restrict database access, and use SSL/TLS for database connections
- **High Availability**: Consider implementing MySQL replication with a master-slave configuration and Redis Sentinel for automatic failover

**Section sources**
- [src/config/config.default.ts](file://src/config/config.default.ts#L40-L95)
- [package.json](file://package.json#L11-L12)

## Process Management and System Integration

The application should be deployed using process management tools to ensure reliability and automatic restart in case of failures. While PM2 is listed as a peer dependency in package.json, systemd can also be used for production deployments on Linux systems.

For PM2 deployment:
```bash
npm install -g pm2
pm2 start bootstrap.js --name goods_hunter --node-args="--max-old-space-size=4096"
pm2 startup
pm2 save
```

For systemd deployment, create a service file at `/etc/systemd/system/goods_hunter.service`:
```ini
[Unit]
Description=Goods Hunter Application
After=network.target

[Service]
Type=simple
User=goods_hunter
WorkingDirectory=/path/to/goods_hunter
ExecStart=/usr/bin/node bootstrap.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Log rotation is handled through nginx access and error logs, but application-level logging should also be configured. The Midway.js logger (enabled via `replaceEggLogger: true`) provides structured logging that can be integrated with log rotation tools like logrotate.

Health checks can be implemented by creating a dedicated endpoint (e.g., `/health`) that verifies database connectivity, Redis availability, and other critical services. This endpoint can be monitored by infrastructure tools or load balancers to ensure application availability.

**Section sources**
- [package.json](file://package.json#L60-L61)
- [src/config/config.default.ts](file://src/config/config.default.ts#L30-L34)
- [src/middleware/errorCatch.ts](file://src/middleware/errorCatch.ts#L1-L51)

## Environment Configuration and CI/CD Considerations

The application uses a hierarchical configuration system with different configuration files for various environments: `config.default.ts` (default settings), `config.local.ts` (local development), and `config.unittest.ts` (testing). This pattern allows for environment-specific overrides while maintaining a consistent base configuration.

Key environment-specific considerations:
- **Production Configuration**: Create a `config.prod.ts` file that overrides sensitive settings like database credentials, disables debugging features, and configures appropriate logging levels
- **Secret Management**: Sensitive configuration data (email credentials, API keys, database passwords) is loaded from JSON files in the private directory. In production, use environment variables or a secrets management service instead of file-based storage
- **Environment Variables**: The application uses `proxyInbound` from environment variables, demonstrating the pattern for external configuration

For CI/CD pipeline implementation:
1. **Build Phase**: Run `npm run build` to compile TypeScript code
2. **Test Phase**: Execute `npm run test` to run Jest tests
3. **Linting**: Run `npm run lint` as part of the pre-commit or pre-push hooks
4. **Deployment**: Use a deployment tool (Ansible, Kubernetes, or cloud-specific solutions) to deploy the built application to production servers
5. **Rollback Strategy**: Maintain previous versions and implement automated rollback procedures in case of deployment failures

**Section sources**
- [src/config/config.default.ts](file://src/config/config.default.ts#L1-L103)
- [src/config/config.local.ts](file://src/config/config.local.ts#L1-L10)
- [src/api/const.ts](file://src/api/const.ts#L1)
- [package.json](file://package.json#L66-L77)

## Scaling and Containerization

The goods_hunter application can be scaled horizontally to handle increased load. The current architecture, with externalized state in MySQL and Redis, supports multiple application instances behind a load balancer.

For containerization using Docker:
1. Create a Dockerfile that installs dependencies, builds the application, and exposes port 7001
2. Use multi-stage builds to reduce image size
3. Configure health checks in the Docker container
4. Use Docker Compose or Kubernetes for orchestrating the complete stack (application, MySQL, Redis, nginx)

Example Docker deployment considerations:
- **Resource Limits**: Set appropriate memory and CPU limits based on application requirements
- **Networking**: Configure proper network policies and service discovery
- **Persistent Storage**: Ensure MySQL data is stored on persistent volumes
- **Service Mesh**: Consider implementing service mesh patterns for advanced traffic management

Horizontal scaling patterns include:
- Running multiple instances of the application server behind nginx or a cloud load balancer
- Implementing session affinity if needed (though the current architecture appears stateless)
- Scaling Redis and MySQL independently based on their specific workload characteristics

**Section sources**
- [package.json](file://package.json#L62-L64)
- [bootstrap.js](file://bootstrap.js#L3)
- [src/config/config.default.ts](file://src/config/config.default.ts#L80-L83)

## Testing and Pre-Deployment Validation

The application includes a testing framework configured through `jest.config.js`, which sets up Jest with ts-jest for TypeScript support and specifies the test environment as Node.js. Pre-deployment testing is critical to ensure application stability.

To run tests:
```bash
npm run test
```

The testing setup includes:
- Jest as the test runner with ts-jest for TypeScript compilation
- Node.js test environment
- Custom setup file (`jest.setup.js`) executed before each test
- Path and coverage ignore patterns to exclude fixtures and test directories

Pre-deployment validation should include:
1. **Unit Tests**: Verify individual functions and services
2. **Integration Tests**: Test API endpoints and database interactions
3. **Performance Testing**: Assess application behavior under load
4. **Security Scanning**: Check for vulnerabilities in dependencies
5. **Configuration Validation**: Ensure production configuration files are present and correct

The existing test files in `test/controller/` provide a foundation for testing the application's controller layer, which can be expanded to cover additional components.

**Section sources**
- [jest.config.js](file://jest.config.js#L1-L8)
- [package.json](file://package.json#L70)
- [test/controller/api.test.ts](file://test/controller/api.test.ts)
- [test/controller/home.test.ts](file://test/controller/home.test.ts)

## Troubleshooting Common Deployment Issues

When deploying the goods_hunter application, several common issues may arise. Understanding these problems and their solutions can reduce deployment time and improve reliability.

**Port Conflicts**: 
- The application defaults to port 7001 (configured in both `bootstrap.js` and `config.default.ts`)
- If this port is already in use, either stop the conflicting process or modify the port configuration
- Check for conflicts with `netstat -tlnp | grep 7001` on Linux systems

**Permission Errors**:
- Ensure the application has read access to configuration files in the private directory
- Verify write permissions for log files and any temporary directories
- When running as a service, ensure the service user has appropriate file system permissions

**Missing Dependencies**:
- Always run `npm install` before deployment to ensure all dependencies are present
- Check that optional dependencies like PM2 are installed if being used for process management
- Verify that native dependencies (like mysql2) are properly compiled for the target platform

**Database Connection Issues**:
- Confirm MySQL and Redis services are running and accessible
- Verify connection credentials match the production environment
- Check firewall rules allow connections to database ports (3306 for MySQL, 6379 for Redis)

**Configuration Problems**:
- Ensure environment variables are properly set, especially `NODE_ENV`
- Verify that private configuration files exist and contain valid JSON
- Check that the correct configuration file is being loaded for the current environment

**Application Startup Failures**:
- Examine error logs in `/var/log/nginx/error.log` and application logs
- Use `npm run dev` in a staging environment to replicate and debug issues
- Check that all required services (MySQL, Redis) are available before starting the application

**Section sources**
- [bootstrap.js](file://bootstrap.js#L3)
- [src/config/config.default.ts](file://src/config/config.default.ts#L80-L95)
- [src/config/config.default.ts](file://src/config/config.default.ts#L40-L47)
- [external/nginx.conf](file://external/nginx.conf#L46-L47)
- [src/errorCode.ts](file://src/errorCode.ts#L1-L59)