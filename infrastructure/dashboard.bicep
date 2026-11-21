// Owner: Adina. Deploy alongside main.bicep for Azure Storage dashboard hosting.
// Existing Function host storage and Azure SQL are managed by main.bicep.
targetScope = 'resourceGroup'

param location string = 'austriaeast'

@description('Existing GitHub OIDC user-assigned managed identity in this resource group.')
param githubIdentityName string = 'teamverity-github'

@description('Dedicated dashboard storage account. Keep this name stable on later deployments.')
param dashboardStorageName string = 'tvweb${uniqueString(resourceGroup().id)}'

resource githubIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: githubIdentityName
}

resource dashboardStorage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: dashboardStorageName
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowSharedKeyAccess: false
    allowBlobPublicAccess: false
    publicNetworkAccess: 'Enabled'
  }
}

// ARM staticWebsite support requires API version 2025-08-01 or later.
resource webBlobService 'Microsoft.Storage/storageAccounts/blobServices@2025-08-01' = {
  parent: dashboardStorage
  name: 'default'
  properties: {
    staticWebsite: {
      enabled: true
      indexDocument: 'index.html'
    }
  }
}

// The website endpoint serves these files publicly; the blob endpoint stays private.
resource webContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: webBlobService
  name: '$web'
  properties: {
    publicAccess: 'None'
  }
}

var blobContributorRole = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
var readerRole = 'acdd72a7-3385-48ef-bd42-f606fba81ae7'

resource githubWebsiteUpload 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(webContainer.id, githubIdentity.id, blobContributorRole)
  scope: webContainer
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', blobContributorRole)
    principalId: githubIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// Lets the workflow look up the account's real website endpoint, without account keys.
resource githubWebsiteMetadata 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(dashboardStorage.id, githubIdentity.id, readerRole)
  scope: dashboardStorage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', readerRole)
    principalId: githubIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

output webStorageAccountName string = dashboardStorage.name
