class InstallationCredentials {
  final String installationId;
  final String installationToken;
  final String deviceName;
  final String? createdAt;

  const InstallationCredentials({
    required this.installationId,
    required this.installationToken,
    this.deviceName = '',
    this.createdAt,
  });

  bool get isValid =>
      installationId.trim().isNotEmpty && installationToken.trim().isNotEmpty;

  factory InstallationCredentials.fromJson(Map<String, dynamic> json) {
    return InstallationCredentials(
      installationId: json['installation_id']?.toString().trim() ?? '',
      installationToken: json['installation_token']?.toString().trim() ?? '',
      deviceName: json['device_name']?.toString().trim() ?? '',
      createdAt: json['created_at']?.toString(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'installation_id': installationId,
      'installation_token': installationToken,
      'device_name': deviceName,
      'created_at': createdAt,
    };
  }
}
