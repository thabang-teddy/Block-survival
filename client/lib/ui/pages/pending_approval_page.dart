/// Shown after a correct sign-in from a device no admin has approved yet —
/// twin of `Pages/PendingApproval.tsx`. The session polls the status endpoint
/// and this page offers the way back to sign-in once the device is through.
library;

import 'package:block_survival/app/session.dart';
import 'package:block_survival/ui/theme.dart';
import 'package:flutter/material.dart';

class PendingApprovalPage extends StatelessWidget {
  const PendingApprovalPage({super.key, required this.session});

  final AppSession session;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: session,
      builder: (context, _) {
        final approved = session.deviceApproved;
        return MenuCard(
          maxWidth: 520,
          tagline: approved
              ? 'This device is approved.'
              : 'This device is waiting for approval.',
          children: [
            if (approved) ...[
              const Text(
                'An admin has approved this device — you can sign in now.',
              ),
              const SizedBox(height: 12),
              FilledButton(
                onPressed: session.backToSignIn,
                child: const Text('Sign in'),
              ),
            ] else ...[
              const Text(
                'Your password was right, but this is the first time this '
                'device has signed in. An admin has to approve it before you '
                'can play. Ask them to approve it in the admin section — it '
                "shows up on the Devices page under this device's name.",
              ),
              const SizedBox(height: 10),
              const Row(
                children: [
                  SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                  SizedBox(width: 10),
                  Expanded(
                    child: Fine(
                      'This page checks every 10 seconds and will tell you '
                      'when you are through.',
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              LinkButton('Back to sign in', onPressed: session.backToSignIn),
            ],
          ],
        );
      },
    );
  }
}
