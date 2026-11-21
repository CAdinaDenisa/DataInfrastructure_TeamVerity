// Owner: Adina
// Telemetry database: Azure SQL Database.
// The storage account supports the Function host and deployment packages.

param functionName string
param location string = resourceGroup().location

@description('Globally unique Azure SQL logical server name.')
param sqlServerName string = 'teamverity-sql-${uniqueString(resourceGroup().id)}'
param sqlDatabaseName string = 'telemetrydb'

@description('UPN or display name of the Microsoft Entra user assigned as SQL administrator.')
param sqlAdminLogin string

@description('Object ID of that user in the subscription tenant, not a client ID or subscription ID.')
param sqlAdminObjectId string

@description('Optional public IPv4 address of the administrator workstation. Empty creates no workstation rule.')
param sqlAdminIp string = ''

@description('Demo option: admit network connections from Azure services, including other tenants. SQL authentication and permissions are still required.')
param allowAzureServices bool = false

@secure()
@description('Preserve the current server-side company/token-hash map on every reapply. Use [] only for initial provisioning before company tokens are configured.')
param demoTenantsJson string

var storageName = 'tv${uniqueString(resourceGroup().id)}'

// Function host/package/diagnostic permissions. These do not grant SQL access.
var hostStorageRoles = [
  'b7e6dc6d-f1e8-4753-8033-0f276bb0955b' // Storage Blob Data Owner
  '974c5e8b-45b9-4653-ba55-5f855dd0fb88' // Storage Queue Data Contributor
  '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3' // Storage Table Data Contributor for host diagnostics
]

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {}
}

resource deploymentContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'function-packages'
  properties: {
    publicAccess: 'None'
  }
}

resource queueService 'Microsoft.Storage/storageAccounts/queueServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {}
}

// SQL uses Microsoft Entra authentication only. No SQL password is deployed.
resource sqlServer 'Microsoft.Sql/servers@2023-08-01' = {
  name: sqlServerName
  location: location
  properties: {
    version: '12.0'
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    administrators: {
      administratorType: 'ActiveDirectory'
      azureADOnlyAuthentication: true
      login: sqlAdminLogin
      sid: sqlAdminObjectId
      tenantId: subscription().tenantId
      principalType: 'User'
    }
  }
}

// Small provisioned DTU database. Check regional pricing before deployment.
resource sqlDatabase 'Microsoft.Sql/servers/databases@2023-08-01' = {
  parent: sqlServer
  name: sqlDatabaseName
  location: location
  sku: {
    name: 'Basic'
    tier: 'Basic'
    capacity: 5
  }
  properties: {
    maxSizeBytes: 2147483648
    requestedBackupStorageRedundancy: 'Local'
  }
}

// A demo networking choice, not an identity or database permission grant.
resource allowAzure 'Microsoft.Sql/servers/firewallRules@2023-08-01' = if (allowAzureServices) {
  parent: sqlServer
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource allowAdminWorkstation 'Microsoft.Sql/servers/firewallRules@2023-08-01' = if (!empty(sqlAdminIp)) {
  parent: sqlServer
  name: 'AdinaWorkstation'
  properties: {
    startIpAddress: sqlAdminIp
    endIpAddress: sqlAdminIp
  }
}

resource functionPlan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: '${functionName}-plan'
  location: location
  kind: 'functionapp'
  sku: {
    name: 'FC1'
    tier: 'FlexConsumption'
  }
  properties: {
    reserved: true
  }
}

resource api 'Microsoft.Web/sites@2024-04-01' = {
  name: functionName
  location: location
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: functionPlan.id
    httpsOnly: true
    functionAppConfig: {
      runtime: {
        name: 'node'
        version: '24'
      }
      scaleAndConcurrency: {
        maximumInstanceCount: 40
        instanceMemoryMB: 2048
      }
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storage.properties.primaryEndpoints.blob}${deploymentContainer.name}'
          authentication: {
            type: 'SystemAssignedIdentity'
          }
        }
      }
    }
    siteConfig: {
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      cors: {
        allowedOrigins: [
          'http://localhost:5173'
        ]
      }
      appSettings: [
        {
          name: 'AzureWebJobsStorage__accountName'
          value: storage.name
        }
        {
          name: 'AzureWebJobsStorage__credential'
          value: 'managedidentity'
        }
        {
          name: 'SQL_SERVER'
          value: sqlServer.properties.fullyQualifiedDomainName
        }
        {
          name: 'SQL_DATABASE'
          value: sqlDatabase.name
        }
        {
          name: 'STORAGE_MODE'
          value: 'azure-sql'
        }
        {
          name: 'DEMO_TENANTS_JSON'
          value: demoTenantsJson
        }
      ]
    }
  }
}

resource hostRoleAssignments 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for roleId in hostStorageRoles: {
  name: guid(storage.id, api.id, roleId)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleId)
    principalId: api.identity.principalId
    principalType: 'ServicePrincipal'
  }
}]

// SQL user creation and dbo.Telemetry schema are applied separately by the
// configured human SQL Entra administrator using the supplied SQL scripts.
output functionAppName string = api.name
output functionPrincipalId string = api.identity.principalId
output functionBaseUrl string = 'https://${api.properties.defaultHostName}'
output storageAccountName string = storage.name
output sqlServerName string = sqlServer.name
output sqlServerFqdn string = sqlServer.properties.fullyQualifiedDomainName
output sqlDatabaseName string = sqlDatabase.name
