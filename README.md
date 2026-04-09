# FileFinder

FileFinder is a serverless file management system built with React on the frontend and AWS serverless services on the backend. It now includes:

- Amazon Cognito user authentication
- Per-user file isolation
- Custom display names for uploaded files
- Amazon S3 storage
- AWS Lambda business logic
- API Gateway REST endpoints
- DynamoDB metadata storage
- Backend input validation and safer CORS handling
- Signed S3 URLs with per-user access enforcement
- Scalability-oriented per-user query guidance

## Architecture

- Frontend: React.js
- Authentication: Amazon Cognito User Pool
- Backend: AWS Lambda + API Gateway
- Storage: Amazon S3
- Metadata: Amazon DynamoDB

## Functional Flow

1. A user signs up or signs in with Amazon Cognito.
2. The frontend stores the Cognito ID token and sends it as an `Authorization` header to the API.
3. `POST /upload` with `action: "presign"` returns a presigned S3 URL, generated `fileId`, and resolved display name.
4. The browser uploads directly to S3.
5. The frontend calls `POST /upload` with `action: "complete"` to save metadata in DynamoDB.
6. `GET /files`, `GET /search`, and `DELETE /delete` all operate only on the authenticated user's files.

## Project Structure

```text
backend/
  deleteLambda.js
  listLambda.js
  package.json
  searchLambda.js
  shared.js
  uploadLambda.js
frontend/
  .env.example
  package.json
  public/
    index.html
  src/
    App.js
    auth.js
    components/
      AuthPanel.js
      FileList.js
      Search.js
      Upload.js
    index.js
    styles.css
template.yaml
README.md
```

## Backend Environment Variables

- `S3_BUCKET_NAME`
- `DYNAMODB_TABLE`
- `FRONTEND_ORIGIN`
- `OWNER_INDEX_NAME`
- `MAX_UPLOAD_SIZE_BYTES`

## Frontend Environment Variables

- `REACT_APP_API_URL`
- `REACT_APP_COGNITO_USER_POOL_ID`
- `REACT_APP_COGNITO_CLIENT_ID`

## API Endpoints

- `POST /upload`
  - `action: "presign"` with `originalFilename`, `displayName`, and `contentType`
  - `action: "complete"` with `fileId`, `displayName`, `originalFilename`, and `s3Key`
- `GET /search?filename=report`
- `DELETE /delete` with `fileId`
- `GET /files`

All endpoints require a valid Cognito JWT in the `Authorization` header.

## Security Features

- JWT authentication is enforced through Amazon Cognito and the API Gateway default authorizer.
- Each Lambda re-validates the authenticated identity and only serves records belonging to the current `ownerSub`.
- Upload completion validates `fileId`, `s3Key`, MIME type, timestamps, and size limits instead of trusting client metadata blindly.
- Search inputs, display names, filenames, and deletion requests are validated and length-limited to reduce malformed or abusive requests.
- API responses now support a configurable `FRONTEND_ORIGIN` and include basic hardening headers.

## DynamoDB Table

- Table name: `FileFinderRecords`
- Partition key: `filename` as `String`

Stored attributes:

- `filename` as the internal record ID
- `fileId`
- `ownerSub`
- `ownerEmail`
- `ownerUsername`
- `displayName`
- `displayNameLower`
- `originalFilename`
- `originalFilenameLower`
- `s3Key`
- `uploadedAt`
- `uploadedAtEpoch`
- `size`
- `contentType`

Recommended GSI for scale:

- `ownerSub-uploadedAt-index`
  - Partition key: `ownerSub`
  - Sort key: `uploadedAtEpoch`

## Required IAM Permissions

Attach these permissions to each Lambda function as needed:

- S3:
  - `s3:PutObject`
  - `s3:GetObject`
  - `s3:DeleteObject`
- DynamoDB:
  - `dynamodb:PutItem`
  - `dynamodb:Scan`
  - `dynamodb:GetItem`
  - `dynamodb:DeleteItem`

## S3 CORS Configuration

If you create the bucket manually, use:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST", "DELETE"],
    "AllowedOrigins": ["http://localhost:3000"]
  }
]
```

## Scalability Considerations

- The backend can use an optional DynamoDB GSI named by `OWNER_INDEX_NAME` so list and search requests query by `ownerSub` instead of scanning the entire table.
- When that index is not available, the code falls back to filtered scans for compatibility, which is fine for demos but not ideal for high-volume usage.
- API Gateway throttling is enabled in `template.yaml` to smooth traffic bursts and reduce abuse.
- For larger deployments, add pagination tokens, CloudWatch alarms, and a server-authoritative upload completion flow using S3 events or Step Functions.

## Suggested Improvements

- Add silent session renewal in the frontend using refresh-token aware flows.
- Move metadata persistence to an event-driven path so the backend does not rely on a client-side `complete` call.
- Add an audit trail or activity log table for compliance-sensitive environments.
- Put CloudFront in front of the frontend and restrict `FRONTEND_ORIGIN` to production domains only.

## AWS Setup Steps

### Option 1: Deploy with AWS SAM

1. Install Node.js 18+ or 20+, AWS CLI, and AWS SAM CLI.
2. Configure AWS credentials:

```bash
aws configure
```

3. Install backend dependencies:

```bash
cd /Users/Aryan/Desktop/new-cloud/backend
npm install
```

4. Build and deploy:

```bash
cd /Users/Aryan/Desktop/new-cloud
sam build
sam deploy --guided
```

5. After deployment, copy these CloudFormation outputs:
   - `ApiUrl`
   - `CognitoUserPoolId`
   - `CognitoUserPoolClientId`

### Option 2: Deploy with AWS CLI Packaging

1. Ensure your S3 uploads bucket and DynamoDB table already exist.
2. Package the template:

```bash
aws cloudformation package \
  --template-file template.yaml \
  --s3-bucket YOUR_DEPLOY_BUCKET \
  --output-template-file packaged.yaml
```

3. Deploy it:

```bash
aws cloudformation deploy \
  --template-file packaged.yaml \
  --stack-name filefinder-app-stack \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides BucketName=YOUR_UPLOAD_BUCKET TableName=FileFinderRecords
```

4. Read the stack outputs for the API URL and Cognito identifiers.

## Frontend Local Run Steps

1. Install frontend dependencies:

```bash
cd /Users/Aryan/Desktop/new-cloud/frontend
npm install
```

2. Create the env file:

```bash
cp .env.example .env
```

3. Fill in the deployed values:

```env
REACT_APP_API_URL=https://your-api-id.execute-api.your-region.amazonaws.com/Prod
REACT_APP_COGNITO_USER_POOL_ID=us-east-1_example
REACT_APP_COGNITO_CLIENT_ID=exampleclientid123456789
```

4. Start the React dev server:

```bash
npm start
```

## Authentication Flow

- Users sign up with `name`, `email`, and `password`
- Cognito emails a verification code
- Users confirm the account in the frontend
- Users sign in and receive a Cognito ID token
- The frontend sends that token to API Gateway
- API Gateway authorizes the request with the Cognito User Pool authorizer
- Lambda reads the user identity from the JWT claims and scopes file access to that owner

## Custom File Naming

- The upload form accepts a custom name for each file
- The original browser filename is still stored in metadata
- Search matches both custom display name and original filename
- The file list shows both the custom name and the original uploaded filename

## Notes

- This update changes the metadata model to support custom names and authenticated ownership.
- Existing unauthenticated deployments should be redeployed so API Gateway and Cognito are configured together.
- Existing records in DynamoDB that predate this change will not have owner metadata, so authenticated list/search behavior applies cleanly to newly uploaded files.
