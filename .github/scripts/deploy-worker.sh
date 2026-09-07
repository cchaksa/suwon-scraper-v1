#!/usr/bin/env bash
# 워커 이미지를 빌드하고 ECS task definition과 EventBridge Pipe를 갱신한다.

set -euo pipefail

required_vars=(
  "AWS_REGION"
  "CONTAINER_NAME"
  "DEPLOY_ENVIRONMENT"
  "ECR_REGISTRY"
  "ECR_REPOSITORY"
  "PIPE_NAME"
  "TASK_DEFINITION_FILE"
  "CALLBACK_SECRET_ARN"
  "IMAGE_TAG"
)

for var_name in "${required_vars[@]}"; do
  if [ -z "${!var_name:-}" ]; then
    echo "Required environment variable is missing: $var_name"
    exit 1
  fi
done

if [ ! -f "$TASK_DEFINITION_FILE" ]; then
  echo "Task definition template not found: $TASK_DEFINITION_FILE"
  exit 1
fi

IMAGE_URI="$ECR_REGISTRY/$ECR_REPOSITORY:$IMAGE_TAG"

docker build -t "$IMAGE_URI" .
docker push "$IMAGE_URI"

jq --arg image "$IMAGE_URI" --arg container "$CONTAINER_NAME" --arg callbackSecretArn "$CALLBACK_SECRET_ARN" \
  '.containerDefinitions |= map(
    if .name == $container then
      .image = $image
      | .secrets |= map(
          if .name == "SCRAPE_CALLBACK_HMAC_SECRET" then
            .valueFrom = $callbackSecretArn
          else
            .
          end
        )
    else
      .
    end
  )' \
  "$TASK_DEFINITION_FILE" > rendered-task-definition.json

RENDERED_SECRET_ARN=$(jq -r --arg container "$CONTAINER_NAME" '
  .containerDefinitions[]
  | select(.name == $container)
  | .secrets[]
  | select(.name == "SCRAPE_CALLBACK_HMAC_SECRET")
  | .valueFrom
' rendered-task-definition.json)

if [ "$RENDERED_SECRET_ARN" != "$CALLBACK_SECRET_ARN" ]; then
  echo "Rendered secret ARN mismatch: expected=$CALLBACK_SECRET_ARN actual=$RENDERED_SECRET_ARN"
  exit 1
fi

case "$RENDERED_SECRET_ARN" in
  arn:aws:secretsmanager:*)
    ;;
  *)
    echo "Rendered secret valueFrom must be a Secrets Manager ARN: actual=$RENDERED_SECRET_ARN"
    exit 1
    ;;
esac

TASK_DEFINITION_ARN=$(aws ecs register-task-definition \
  --cli-input-json file://rendered-task-definition.json \
  --query 'taskDefinition.taskDefinitionArn' \
  --output text)

aws ecs describe-task-definition \
  --task-definition "$TASK_DEFINITION_ARN" \
  --output json > registered-task-definition.json

REGISTERED_SECRET_ARN=$(jq -r --arg container "$CONTAINER_NAME" '
  .taskDefinition.containerDefinitions[]
  | select(.name == $container)
  | .secrets[]
  | select(.name == "SCRAPE_CALLBACK_HMAC_SECRET")
  | .valueFrom
' registered-task-definition.json)

if [ "$REGISTERED_SECRET_ARN" != "$CALLBACK_SECRET_ARN" ]; then
  echo "Registered task definition secret ARN mismatch: expected=$CALLBACK_SECRET_ARN actual=$REGISTERED_SECRET_ARN"
  exit 1
fi

aws pipes describe-pipe --name "$PIPE_NAME" > pipe-description.json
ROLE_ARN=$(jq -r '.RoleArn' pipe-description.json)
SOURCE_ARN=$(jq -r '.Source' pipe-description.json)
TARGET_ARN=$(jq -r '.Target' pipe-description.json)

jq \
  '.SourceParameters
  | .SqsQueueParameters.BatchSize = 1
  | .SqsQueueParameters.MaximumBatchingWindowInSeconds = 0' \
  pipe-description.json > updated-source-parameters.json

# EventBridge Pipes ECS target dynamic parameters use per-record JSON path.
# For an SQS source with BatchSize=1, use $.body / $.messageId instead of $[0].*.
jq --arg taskDefArn "$TASK_DEFINITION_ARN" --arg container "$CONTAINER_NAME" \
  '.TargetParameters
  | .EcsTaskParameters.TaskDefinitionArn = $taskDefArn
  | .EcsTaskParameters.Overrides.ContainerOverrides = [
      {
        "Name": $container,
        "Environment": [
          { "name": "SQS_MESSAGE_BODY", "value": "$.body" },
          { "name": "SQS_MESSAGE_ID", "value": "$.messageId" }
        ]
      }
    ]' \
  pipe-description.json > updated-target-parameters.json

aws pipes update-pipe \
  --name "$PIPE_NAME" \
  --role-arn "$ROLE_ARN" \
  --source "$SOURCE_ARN" \
  --target "$TARGET_ARN" \
  --source-parameters file://updated-source-parameters.json \
  --target-parameters file://updated-target-parameters.json >/dev/null

aws pipes describe-pipe --name "$PIPE_NAME" > updated-pipe-description.json

CURRENT_PIPE_BATCH_SIZE=$(jq -r '.SourceParameters.SqsQueueParameters.BatchSize' updated-pipe-description.json)
CURRENT_PIPE_TASK_ARN=$(jq -r '.TargetParameters.EcsTaskParameters.TaskDefinitionArn' updated-pipe-description.json)
CURRENT_PIPE_BODY_ENV=$(jq -r --arg container "$CONTAINER_NAME" '
  .TargetParameters.EcsTaskParameters.Overrides.ContainerOverrides[]?
  | select(.Name == $container)
  | .Environment[]?
  | select((.name // .Name) == "SQS_MESSAGE_BODY")
  | (.value // .Value)
' updated-pipe-description.json)
CURRENT_PIPE_MESSAGE_ID_ENV=$(jq -r --arg container "$CONTAINER_NAME" '
  .TargetParameters.EcsTaskParameters.Overrides.ContainerOverrides[]?
  | select(.Name == $container)
  | .Environment[]?
  | select((.name // .Name) == "SQS_MESSAGE_ID")
  | (.value // .Value)
' updated-pipe-description.json)

if [ "$CURRENT_PIPE_BATCH_SIZE" != "1" ]; then
  echo "Pipe batch size mismatch: expected=1 actual=$CURRENT_PIPE_BATCH_SIZE"
  exit 1
fi

if [ "$CURRENT_PIPE_TASK_ARN" != "$TASK_DEFINITION_ARN" ]; then
  echo "Pipe task definition ARN mismatch: expected=$TASK_DEFINITION_ARN actual=$CURRENT_PIPE_TASK_ARN"
  exit 1
fi

if [ "$CURRENT_PIPE_BODY_ENV" != '$.body' ]; then
  echo "Pipe body env mismatch: expected=\$.body actual=$CURRENT_PIPE_BODY_ENV"
  exit 1
fi

if [ "$CURRENT_PIPE_MESSAGE_ID_ENV" != '$.messageId' ]; then
  echo "Pipe message id env mismatch: expected=\$.messageId actual=$CURRENT_PIPE_MESSAGE_ID_ENV"
  exit 1
fi

cat > deployment-output.json <<EOF
{
  "deploy_environment": "$DEPLOY_ENVIRONMENT",
  "git_ref_name": "${GIT_REF_NAME:-}",
  "ecr_repository": "$ECR_REPOSITORY",
  "image_uri": "$IMAGE_URI",
  "task_definition_arn": "$TASK_DEFINITION_ARN",
  "pipe_name": "$PIPE_NAME",
  "pipe_task_definition_arn": "$CURRENT_PIPE_TASK_ARN"
}
EOF

echo "$IMAGE_URI" > image-uri.txt

echo "image_uri=$IMAGE_URI" >> "$GITHUB_OUTPUT"
echo "task_definition_arn=$TASK_DEFINITION_ARN" >> "$GITHUB_OUTPUT"
echo "pipe_task_definition_arn=$CURRENT_PIPE_TASK_ARN" >> "$GITHUB_OUTPUT"

{
  echo "## Worker deployment completed"
  echo ""
  echo "- DEPLOY_ENVIRONMENT: \`$DEPLOY_ENVIRONMENT\`"
  echo "- GIT_REF_NAME: \`${GIT_REF_NAME:-}\`"
  echo "- ECR_REPOSITORY: \`$ECR_REPOSITORY\`"
  echo "- IMAGE_URI: \`$IMAGE_URI\`"
  echo "- TASK_DEFINITION_ARN: \`$TASK_DEFINITION_ARN\`"
  echo "- PIPE_NAME: \`$PIPE_NAME\`"
  echo "- PIPE_TASK_DEFINITION_ARN: \`$CURRENT_PIPE_TASK_ARN\`"
  echo "- Artifact: \`worker-deployment-output/deployment-output.json\`"
  echo "- Required CI IAM: ecs:RegisterTaskDefinition, ecs:DescribeTaskDefinition, pipes:DescribePipe, pipes:UpdatePipe, iam:PassRole"
} >> "$GITHUB_STEP_SUMMARY"

