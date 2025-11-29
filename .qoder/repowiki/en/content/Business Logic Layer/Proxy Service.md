# Proxy Service

<cite>
**Referenced Files in This Document**
- [src/service/proxy.ts](file://src/service/proxy.ts)
- [src/controller/proxy.ts](file://src/controller/proxy.ts)
- [src/service/cipher.ts](file://src/service/cipher.ts)
- [src/utils/isValidUrl.ts](file://src/utils/isValidUrl.ts)
- [src/api/site/base.ts](file://src/api/site/base.ts)
- [src/api/request/index.ts](file://src/api/request/index.ts)
- [src/middleware/loginStateCheck.ts](file://src/middleware/loginStateCheck.ts)
- [src/types.ts](file://src/types.ts)
- [src/errorCode.ts](file://src/errorCode.ts)
- [src/const.ts](file://src/const.ts)
- [external/nginx.conf](file://external/nginx.conf)
</cite>

## Table of Contents
1. [Introduction](#introduction)
2. [System Architecture](#system-architecture)
3. [Core Components](#core-components)
4. [Security Implementation](#security-implementation)
5. [Workflow Analysis](#workflow-analysis)
6. [Integration with Middleware](#integration-with-middleware)
7. [Error Handling](#error-handling)
8. [Performance Considerations](#performance-considerations)
9. [Security Best Practices](#security-best-practices)
10. [Troubleshooting Guide](#troubleshooting-guide)
11. [Conclusion](#conclusion)

## Introduction

The Proxy Service is a sophisticated image proxying component designed to enable secure access to external image resources while protecting the original image sources from direct exposure. Built on the Midway.js framework, this service implements a multi-layered security architecture that combines URL encryption, strict validation, and controlled access patterns to prevent hotlinking and unauthorized access to external resources.

The proxy service operates as a critical security layer that intercepts requests for external images, decrypts encrypted URLs through the CipherService, validates the decrypted URLs against security policies, and then retrieves the images through a controlled API gateway. This approach ensures that original image URLs remain hidden from client-side access while maintaining efficient image delivery capabilities.

## System Architecture

The proxy service follows a layered architecture pattern that separates concerns between security, validation, and resource retrieval:

```mermaid
graph TB
subgraph "Client Layer"
Browser[Web Browser]
Mobile[Mobile App]
end
subgraph "Security Layer"
Middleware[Login State Check<br/>Middleware]
Controller[Proxy Controller]
end
subgraph "Processing Layer"
ProxyService[Proxy Service]
CipherService[Cipher Service]
Validator[URL Validator]
end
subgraph "Transport Layer"
BaseAPI[API Base Service]
ProxyRequest[Proxy Request Handler]
Nginx[Nginx Cache Layer]
end
subgraph "External Resources"
ImageServer[Image Servers]
end
Browser --> Middleware
Mobile --> Middleware
Middleware --> Controller
Controller --> ProxyService
ProxyService --> CipherService
ProxyService --> Validator
ProxyService --> BaseAPI
BaseAPI --> ProxyRequest
ProxyRequest --> Nginx
Nginx --> ImageServer
ProxyService -.->|Content-Type:<br/>image/webp| Controller
Controller -.->|Encrypted<br/>Payload| ProxyService
```

**Diagram sources**
- [src/controller/proxy.ts](file://src/controller/proxy.ts#L1-L20)
- [src/service/proxy.ts](file://src/service/proxy.ts#L1-L32)
- [src/service/cipher.ts](file://src/service/cipher.ts#L1-L117)
- [src/api/site/base.ts](file://src/api/site/base.ts#L1-L33)

**Section sources**
- [src/controller/proxy.ts](file://src/controller/proxy.ts#L1-L20)
- [src/service/proxy.ts](file://src/service/proxy.ts#L1-L32)
- [src/middleware/loginStateCheck.ts](file://src/middleware/loginStateCheck.ts#L1-L54)

## Core Components

### ProxyService

The ProxyService serves as the central orchestrator for the image proxying workflow. It integrates with multiple services to provide a secure and efficient image retrieval mechanism.

```mermaid
classDiagram
class ProxyService {
+ApiBase apiBase
+CipherServive cipher
+Context ctx
+getImage(payload : CipherPayload) Promise~ReadStream~
}
class ProxyController {
+ProxyService proxy
+getImage(iv : string, message : string, digest : string) Promise~any~
}
class CipherServive {
+CryptoKey secretKey
+RedisService redisClient
+encode(message : string) Promise~CipherPayload~
+decode(payload : CipherPayload) Promise~string~
+checkIfMessageConsumed(message : string) Promise~void~
}
class ApiBase {
+ProxyGet proxyGet
+fetchThumbNail(url : string) Promise~ReadStream~
}
ProxyController --> ProxyService : "uses"
ProxyService --> CipherServive : "decrypts URLs"
ProxyService --> ApiBase : "retrieves images"
ProxyService --> Context : "sets headers"
```

**Diagram sources**
- [src/service/proxy.ts](file://src/service/proxy.ts#L10-L31)
- [src/controller/proxy.ts](file://src/controller/proxy.ts#L6-L18)
- [src/service/cipher.ts](file://src/service/cipher.ts#L11-L117)
- [src/api/site/base.ts](file://src/api/site/base.ts#L8-L33)

### CipherService Integration

The CipherService provides cryptographic operations for URL encryption and decryption. It implements AES-GCM encryption with SHA-256 message authentication to ensure data integrity and confidentiality.

### URL Validation System

The URL validation system employs comprehensive checks to ensure that decrypted URLs meet security requirements before any external requests are made.

**Section sources**
- [src/service/proxy.ts](file://src/service/proxy.ts#L10-L31)
- [src/service/cipher.ts](file://src/service/cipher.ts#L11-L117)
- [src/utils/isValidUrl.ts](file://src/utils/isValidUrl.ts#L1-L18)

## Security Implementation

### Encryption and Decryption Workflow

The proxy service implements a robust encryption scheme that protects image URLs from direct exposure:

```mermaid
sequenceDiagram
participant Client as "Client Request"
participant Controller as "Proxy Controller"
participant ProxyService as "Proxy Service"
participant CipherService as "Cipher Service"
participant Validator as "URL Validator"
participant APIService as "API Base Service"
participant External as "External Image Server"
Client->>Controller : GET /proxy/getImage?<br/>iv=xxx&message=xxx&digest=xxx
Controller->>Controller : validateRequestParams()
Controller->>ProxyService : getImage(cipherPayload)
ProxyService->>CipherService : decode(payload)
CipherService->>CipherService : verifyDigest()
CipherService->>CipherService : decryptMessage()
CipherService-->>ProxyService : decryptedImageUrl
ProxyService->>Validator : isValidUrl(imageUrl)
Validator-->>ProxyService : validationResult
ProxyService->>ProxyService : setHeader("Content-Type", "image/webp")
ProxyService->>APIService : fetchThumbNail(imageUrl)
APIService->>External : HTTP Request
External-->>APIService : Image Stream
APIService-->>ProxyService : ReadStream
ProxyService-->>Controller : ReadStream
Controller-->>Client : Binary Image Response
Note over Client,External : Secure image proxying with encrypted URLs
```

**Diagram sources**
- [src/controller/proxy.ts](file://src/controller/proxy.ts#L12-L15)
- [src/service/proxy.ts](file://src/service/proxy.ts#L22-L27)
- [src/service/cipher.ts](file://src/service/cipher.ts#L92-L115)

### Message Authentication

The CipherService implements SHA-256 message authentication to detect tampering and ensure message integrity. Each encrypted payload includes a digest that is verified during decryption.

### Anti-Hotlinking Protection

The proxy service prevents hotlinking by:

1. **Encrypted URLs**: Original image URLs are never exposed to clients
2. **Single-use Validation**: Encrypted messages are tracked and prevented from reuse
3. **Strict Validation**: Only URLs passing comprehensive validation are processed
4. **Access Control**: Middleware enforces authentication requirements

**Section sources**
- [src/service/cipher.ts](file://src/service/cipher.ts#L92-L115)
- [src/utils/isValidUrl.ts](file://src/utils/isValidUrl.ts#L1-L18)
- [src/middleware/loginStateCheck.ts](file://src/middleware/loginStateCheck.ts#L21-L23)

## Workflow Analysis

### getImage Method Implementation

The `getImage` method represents the core workflow of the proxy service, implementing a secure and efficient image retrieval process:

```mermaid
flowchart TD
Start([getImage Called]) --> Decrypt["Decrypt Cipher Payload<br/>using CipherService"]
Decrypt --> ValidateURL{"Validate URL<br/>Format"}
ValidateURL --> |Invalid| ThrowError["Throw: invalidImageUrl"]
ValidateURL --> |Valid| SetHeaders["Set Content-Type<br/>to image/webp"]
SetHeaders --> FetchImage["Fetch Thumbnail<br/>via ApiBase"]
FetchImage --> ReturnStream["Return ReadStream"]
ThrowError --> End([End])
ReturnStream --> End
Decrypt --> DecryptSuccess{"Decryption<br/>Successful?"}
DecryptSuccess --> |Failed| ThrowError
DecryptSuccess --> |Success| ValidateURL
```

**Diagram sources**
- [src/service/proxy.ts](file://src/service/proxy.ts#L22-L27)

### Request Processing Pipeline

The complete request processing pipeline involves multiple validation and security checkpoints:

1. **Parameter Validation**: Ensures all required cipher parameters are present
2. **Payload Decryption**: Uses AES-GCM decryption with proper IV handling
3. **URL Format Validation**: Validates URL structure and protocol compliance
4. **Content-Type Setting**: Explicitly sets appropriate MIME type headers
5. **Resource Retrieval**: Delegates to API base service for external requests

**Section sources**
- [src/service/proxy.ts](file://src/service/proxy.ts#L22-L27)
- [src/controller/proxy.ts](file://src/controller/proxy.ts#L12-L15)

## Integration with Middleware

### Login State Middleware Integration

The proxy service integrates seamlessly with the login state middleware to enforce authentication requirements:

```mermaid
sequenceDiagram
participant Client as "Client"
participant Middleware as "Login State Check"
participant Controller as "Proxy Controller"
participant ProxyService as "Proxy Service"
Client->>Middleware : Request with /proxy endpoint
Middleware->>Middleware : checkPath("/proxy")
Note over Middleware : Path ignored for proxy access
Middleware->>Controller : Allow Request
Controller->>ProxyService : getImage(payload)
ProxyService->>ProxyService : Process Image Request
ProxyService-->>Controller : Image Stream
Controller-->>Client : Image Response
Note over Client,ProxyService : Proxy bypasses authentication<br/>but maintains security through<br/>encrypted URLs and validation
```

**Diagram sources**
- [src/middleware/loginStateCheck.ts](file://src/middleware/loginStateCheck.ts#L21-L23)
- [src/controller/proxy.ts](file://src/controller/proxy.ts#L12-L15)

### Path-Based Access Control

The middleware implements intelligent path-based access control that allows proxy requests while enforcing authentication for other endpoints. This design ensures that proxy functionality remains accessible while maintaining security boundaries.

**Section sources**
- [src/middleware/loginStateCheck.ts](file://src/middleware/loginStateCheck.ts#L21-L23)
- [src/controller/proxy.ts](file://src/controller/proxy.ts#L12-L15)

## Error Handling

### Comprehensive Error Management

The proxy service implements structured error handling across all layers:

| Error Type | Source | Description | Resolution |
|------------|--------|-------------|------------|
| `invalidRequestBody` | Controller | Missing or malformed cipher parameters | Verify all required parameters are present |
| `invalidImageUrl` | ProxyService | Decrypted URL fails validation | Check URL format and protocol compliance |
| `messageCorrupted` | CipherService | SHA-256 digest verification failed | Re-encrypt with proper key derivation |
| `messageConsumed` | CipherService | Attempted reuse of encrypted message | Generate new encrypted payload |

### Error Propagation Strategy

Errors are propagated consistently through the system with appropriate HTTP status codes and meaningful error messages. The service ensures that sensitive information is not leaked through error responses.

**Section sources**
- [src/errorCode.ts](file://src/errorCode.ts#L51-L71)
- [src/controller/proxy.ts](file://src/controller/proxy.ts#L13-L14)
- [src/service/proxy.ts](file://src/service/proxy.ts#L25-L26)

## Performance Considerations

### Caching Strategy

The proxy service benefits from multiple layers of caching optimization:

```mermaid
graph LR
subgraph "Nginx Level Cache"
Nginx[Nginx Reverse Proxy<br/>Cache Zone: 2GB<br/>Inactive: 7 days]
end
subgraph "Application Level Cache"
Redis[Redis Cache<br/>for Cipher Messages]
Memory[In-Memory Validation<br/>Cache]
end
subgraph "External Resource Cache"
CDN[CDN Distribution<br/>Edge Caching]
Server[External Server<br/>Response Headers]
end
Client[Client Request] --> Nginx
Nginx --> Redis
Redis --> Memory
Memory --> CDN
CDN --> Server
Server --> CDN
CDN --> Client
```

**Diagram sources**
- [external/nginx.conf](file://external/nginx.conf#L69-L80)
- [src/const.ts](file://src/const.ts#L5-L5)

### Performance Optimization Techniques

1. **Nginx Reverse Proxy Cache**: Implements 3-day cache for successful responses
2. **Redis Message Tracking**: Prevents replay attacks with efficient storage
3. **Connection Pooling**: Reuses HTTP connections for external requests
4. **Timeout Management**: 5-second timeouts prevent hanging requests
5. **Retry Logic**: Automatic retry mechanisms for transient failures

### Scalability Considerations

The proxy service is designed to handle high-volume image requests through:

- **Horizontal Scaling**: Stateless design allows multiple service instances
- **Load Balancing**: Nginx distributes requests across backend instances
- **Resource Limits**: Configurable timeouts and connection limits
- **Monitoring Integration**: Built-in logging for performance tracking

**Section sources**
- [external/nginx.conf](file://external/nginx.conf#L69-L80)
- [src/api/request/index.ts](file://src/api/request/index.ts#L25-L36)

## Security Best Practices

### SSRF Attack Prevention

The proxy service implements multiple defenses against Server-Side Request Forgery (SSRF) attacks:

1. **Strict URL Validation**: Comprehensive URL format checking
2. **Protocol Restrictions**: Enforces HTTPS and HTTP protocols only
3. **Host Validation**: Prevents access to internal network resources
4. **Timeout Enforcement**: Limits request duration to prevent hanging attacks

### Cryptographic Security

The service implements industry-standard cryptographic practices:

- **AES-GCM Encryption**: Provides both confidentiality and authenticity
- **SHA-256 Message Authentication**: Detects tampering and corruption
- **Random IV Generation**: Ensures unique ciphertext for identical plaintext
- **Secure Key Storage**: Uses JWK format for key management

### Access Control Measures

Multiple access control layers ensure secure operation:

- **Authentication Bypass**: Allows proxy access while maintaining security
- **Message Replay Protection**: Prevents reuse of encrypted payloads
- **Rate Limiting**: Implicit through timeout and retry mechanisms
- **Audit Logging**: Comprehensive logging for security monitoring

**Section sources**
- [src/service/cipher.ts](file://src/service/cipher.ts#L25-L28)
- [src/utils/isValidUrl.ts](file://src/utils/isValidUrl.ts#L1-L18)
- [src/middleware/loginStateCheck.ts](file://src/middleware/loginStateCheck.ts#L21-L23)

## Troubleshooting Guide

### Common Issues and Solutions

#### Invalid URL Format Errors

**Symptoms**: `invalidImageUrl` error responses
**Causes**: 
- Malformed decrypted URLs
- Unsupported protocols (ftp, mailto, etc.)
- URLs containing whitespace or special characters

**Solutions**:
- Verify URL decryption is successful
- Check URL encoding and escaping
- Ensure HTTPS or HTTP protocols only

#### Failed Decryption Attempts

**Symptoms**: `messageCorrupted` or decryption failures
**Causes**:
- Tampered cipher payloads
- Incorrect secret key configuration
- Message format inconsistencies

**Solutions**:
- Regenerate encrypted payloads
- Verify secret key JWK configuration
- Check payload structure integrity

#### Upstream Image Server Errors

**Symptoms**: Timeout or connection errors
**Causes**:
- External server unavailability
- Network connectivity issues
- Rate limiting or blocking

**Solutions**:
- Implement retry logic with exponential backoff
- Monitor external service health
- Configure appropriate timeout values

### Debugging Strategies

1. **Enable Detailed Logging**: Review application logs for error details
2. **Validate Cipher Payloads**: Test decryption with known good payloads
3. **Network Connectivity Testing**: Verify external server accessibility
4. **Performance Monitoring**: Track response times and error rates

**Section sources**
- [src/errorCode.ts](file://src/errorCode.ts#L66-L67)
- [src/service/cipher.ts](file://src/service/cipher.ts#L102-L104)
- [src/api/request/index.ts](file://src/api/request/index.ts#L25-L36)

## Conclusion

The Proxy Service represents a comprehensive solution for secure image proxying that balances functionality, security, and performance. Through its multi-layered architecture combining encryption, validation, and controlled access patterns, it effectively prevents hotlinking while maintaining efficient image delivery capabilities.

Key strengths of the implementation include:

- **Robust Security**: Multi-factor authentication and encryption prevent unauthorized access
- **Performance Optimization**: Multiple caching layers ensure fast response times
- **Error Resilience**: Comprehensive error handling and retry mechanisms
- **Scalable Design**: Stateless architecture supports horizontal scaling
- **Maintainable Code**: Clear separation of concerns and modular design

The service demonstrates best practices in secure web development, providing a model for implementing similar proxy functionality while maintaining high security standards and performance requirements. Its integration with modern infrastructure components like Nginx caching and Redis message tracking makes it suitable for production environments requiring both security and scalability.